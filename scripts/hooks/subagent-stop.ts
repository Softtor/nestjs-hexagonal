import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { changedFilesSince, projectSources, readSources } from '../lib/project-files.ts';
import { isInScope } from '../lib/scope.ts';
import { emptySession, type AgentSession } from '../lib/session-store.ts';
import { runStaticRules, type Finding } from '../lib/static-engine.ts';
import {
  PREFIX,
  apiKey,
  formatStaticFinding,
  isPluginAgent,
  loadRulebook,
  projectDir,
  semanticAdvisory,
  sessionStore,
  skip,
  staticRules,
  toUnresolved,
  uniqueRuleIds,
  type HookHandler,
} from './lib/hook-common.ts';
import { blockOutput, systemMessageOutput } from './lib/hook-io.ts';
import { runHookMain } from './lib/runner.ts';

/**
 * Claude Code ends a subagent after 8 consecutive blocks; this plugin releases
 * earlier so an agent that cannot satisfy a rule never burns the whole budget,
 * and the residual report reaches the parent through the Agent PostToolUse hook.
 */
export const MAX_BLOCKS = 2;
export const REASON_MAX_FINDINGS = 20;
/** Must match hooks/hooks.json; the semantic deadline leaves 3 s for the static run and the output. */
export const SUBAGENT_STOP_TIMEOUT_S = 20;
const SEMANTIC_DEADLINE_MS = (SUBAGENT_STOP_TIMEOUT_S - 3) * 1000;
const SEMANTIC_CONCURRENCY = 8;

/**
 * Paths recorded by PostToolUse plus, when SubagentStart recorded the HEAD,
 * what git sees changed since then minus the files that were already dirty
 * at that moment (the developer's or a sibling agent's work). Without a
 * recorded HEAD the diff is skipped because it could not be attributed.
 */
export function touchedFiles(session: AgentSession, project: string): string[] {
  const baseline = new Set(session.baseline);
  const fromGit = session.headSha === null ? [] : (changedFilesSince(session.headSha, project) ?? []).filter((path) => !baseline.has(path));
  const union = new Set<string>([...session.touchedPaths, ...fromGit]);
  return [...union].filter((path) => existsSync(resolve(project, path)) && statSync(resolve(project, path)).isFile()).sort();
}

export function blockReason(agentType: string, fails: Finding[]): string {
  const shown = fails.slice(0, REASON_MAX_FINDINGS).map(formatStaticFinding);
  const more = fails.length > REASON_MAX_FINDINGS ? [`${PREFIX} ${fails.length - REASON_MAX_FINDINGS} more FAIL finding(s)`] : [];
  return [`${PREFIX} ${fails.length} static FAIL finding(s) remain in files ${agentType} touched. Fix them, then finish again:`, ...shown, ...more].join('\n');
}

export function releaseMessage(agentType: string, fails: Finding[]): string {
  const summary = fails.map((finding) => `${finding.ruleId} ${finding.path}${finding.line === undefined ? '' : `:${finding.line}`}`).join(', ');
  return `nestjs-hexagonal: ${MAX_BLOCKS} blocks reached, releasing ${agentType} with unresolved FAILs: ${summary}`;
}

export const handler: HookHandler = async (input, context) => {
  if (!isPluginAgent(input.agent_type) || input.agent_id === undefined) {
    return skip();
  }
  const loaded = loadRulebook(input, context);
  if (!loaded.ok) {
    return { ...skip(), stderr: `${PREFIX} subagent-stop: ${loaded.reason}` };
  }
  const agentType = input.agent_type;
  const agentId = input.agent_id;
  const composed = loaded.composed;
  const project = projectDir(input, context);
  const store = sessionStore(context);
  const now = context.now ?? Date.now;
  const session = store.read(input.session_id, agentId) ?? emptySession(agentType, new Date(now()).toISOString(), null);

  const paths = touchedFiles(session, project).filter((path) => composed.rules.some((rule) => rule.class !== 'runtime' && isInScope(rule.scope, path)));
  if (paths.length === 0) {
    store.update(input.session_id, agentId, (current) => ({ ...current, unresolved: [] }));
    return { output: null, decision: 'silent' };
  }
  const files = readSources(paths, project);
  const bodies = files.map((file) => file.content);
  const staticResult = runStaticRules(staticRules(composed.rules, { external: true }), files, { projectFiles: () => projectSources(project) });
  const fails = staticResult.findings.filter((finding) => finding.severity === 'FAIL');
  if (fails.length === 0) {
    // Clean stop: the semantic advisory runs under a deadline and is kept for the parent (Agent hook), never shown to the stopping agent.
    const key = apiKey(context.env);
    const advisory = key === undefined ? null : await semanticAdvisory(composed, files, key, context, { concurrency: SEMANTIC_CONCURRENCY, deadlineMs: SEMANTIC_DEADLINE_MS });
    store.update(input.session_id, agentId, (current) => ({ ...current, unresolved: [], advisory: advisory?.lines ?? [] }));
    return {
      output: null,
      decision: 'silent',
      ruleIds: uniqueRuleIds([...staticResult.findings, ...(advisory?.findings ?? [])]),
      bodies,
      ...(advisory ? { semantic: advisory.stats } : {}),
    };
  }

  // A static FAIL blocks at once: no network on the blocking path, so the hook timeout can never discard the decision.
  const ruleIds = uniqueRuleIds(fails);
  const unresolved = fails.map(toUnresolved);
  if (session.blocks < MAX_BLOCKS) {
    store.update(input.session_id, agentId, (current) => ({ ...current, blocks: current.blocks + 1, unresolved, advisory: [] }));
    return { output: blockOutput(blockReason(agentType, fails)), decision: 'block', ruleIds, bodies };
  }
  store.update(input.session_id, agentId, (current) => ({ ...current, unresolved, advisory: [] }));
  return { output: systemMessageOutput(releaseMessage(agentType, fails)), decision: 'release', ruleIds, bodies };
};

await runHookMain('subagent-stop', handler, import.meta.url);
