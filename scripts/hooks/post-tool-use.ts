import { existsSync, readFileSync } from 'node:fs';
import { projectSources } from '../lib/project-files.ts';
import { emptySession } from '../lib/session-store.ts';
import { runStaticRules } from '../lib/static-engine.ts';
import {
  PREFIX,
  apiKey,
  formatStaticFinding,
  isPluginAgent,
  loadRulebook,
  projectDir,
  relativeProjectPath,
  rulesInScope,
  semanticAdvisory,
  sessionStore,
  skip,
  staticRules,
  uniqueRuleIds,
  type HookHandler,
  type HookResult,
} from './lib/hook-common.ts';
import { contextOutput, fileToolInput } from './lib/hook-io.ts';
import { runHookMain } from './lib/runner.ts';

/** Advisory bytes one agent receives per session before the hook falls back to a one-line notice. */
export const ADVISORY_BYTE_CAP = 8 * 1024;
export const MAIN_THREAD_AGENT_ID = 'main';
/** Must match hooks/hooks.json; the semantic deadline leaves 2 s for the static run and the output. */
export const POST_TOOL_USE_TIMEOUT_S = 15;
const SEMANTIC_DEADLINE_MS = (POST_TOOL_USE_TIMEOUT_S - 2) * 1000;
const SEMANTIC_CONCURRENCY = 4;

export const handler: HookHandler = async (input, context) => {
  const tool = fileToolInput(input);
  if (tool === null) {
    return skip();
  }
  const project = projectDir(input, context);
  const path = relativeProjectPath(project, tool.input.file_path);
  if (path === null) {
    return skip();
  }
  const loaded = loadRulebook(input, context);
  if (!loaded.ok) {
    return { ...skip(), stderr: `${PREFIX} post-tool-use: ${loaded.reason}` };
  }
  const store = sessionStore(context);
  const agentId = input.agent_id ?? MAIN_THREAD_AGENT_ID;
  const now = context.now ?? Date.now;
  const session = store.update(input.session_id, agentId, (current) => {
    const base = current.agentType === 'unknown' ? emptySession(input.agent_type ?? MAIN_THREAD_AGENT_ID, new Date(now()).toISOString(), null) : current;
    return base.touchedPaths.includes(path) ? base : { ...base, touchedPaths: [...base.touchedPaths, path] };
  });

  const composed = loaded.composed;
  const inScopeStatic = rulesInScope(staticRules(composed.rules, { external: true }), path);
  const semanticEligible = input.agent_id !== undefined && isPluginAgent(input.agent_type);
  const key = semanticEligible ? apiKey(context.env) : undefined;
  const inScopeSemantic = key === undefined ? [] : rulesInScope(composed.rules.filter((rule) => rule.class === 'semantic'), path);
  if (inScopeStatic.length === 0 && inScopeSemantic.length === 0) {
    return { output: null, decision: 'silent', path };
  }
  if (!existsSync(tool.input.file_path)) {
    return { output: null, decision: 'silent', path };
  }
  const content = readFileSync(tool.input.file_path, 'utf8');
  const file = { path, content };
  const bodies = [content, tool.tool === 'Write' ? tool.input.content : tool.input.new_string];

  const staticResult = inScopeStatic.length === 0 ? { findings: [] } : runStaticRules(inScopeStatic, [file], { projectFiles: () => projectSources(project) });
  const lines = staticResult.findings.map(formatStaticFinding);
  const result: HookResult = { output: null, decision: 'silent', path, bodies, ruleIds: uniqueRuleIds(staticResult.findings) };
  if (key !== undefined && inScopeSemantic.length > 0) {
    const advisory = await semanticAdvisory(composed, [file], key, context, { concurrency: SEMANTIC_CONCURRENCY, deadlineMs: SEMANTIC_DEADLINE_MS });
    lines.push(...advisory.lines);
    result.semantic = advisory.stats;
    result.ruleIds = uniqueRuleIds([...staticResult.findings, ...advisory.findings]);
  }
  if (lines.length === 0) {
    return result;
  }
  if (session.advisoryBytes >= ADVISORY_BYTE_CAP) {
    return {
      ...result,
      decision: 'context',
      output: contextOutput('PostToolUse', `${PREFIX} advisory cap reached for this agent in this session; run nestjs-hexagonal-check --files ${path} for the findings`),
    };
  }
  const text = [`${PREFIX} ${lines.length} finding(s) in ${path}:`, ...lines].join('\n');
  store.update(input.session_id, agentId, (current) => ({ ...current, advisoryBytes: current.advisoryBytes + Buffer.byteLength(text) }));
  return { ...result, decision: 'context', output: contextOutput('PostToolUse', text) };
};

await runHookMain('post-tool-use', handler, import.meta.url);
