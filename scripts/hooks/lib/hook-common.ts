import { join } from 'node:path';
import { RulebookCompositionError, semanticRulebookVersion, type ComposedRulebook } from '../../lib/compose.ts';
import { loadFitted, type FittedFile } from '../../lib/decide.ts';
import type { HookDecision, HookLogEntry } from '../../lib/hook-log.ts';
import { createJevClient, type FetchLike } from '../../lib/jev-client.ts';
import { RulebookNotFoundError, loadProjectRulebook, projectDirOf } from '../../lib/project-rulebook.ts';
import type { Rule } from '../../lib/rulebook.schema.ts';
import { isInScope, normalizePath } from '../../lib/scope.ts';
import { runSemanticRules, type SemanticFinding } from '../../lib/semantic-engine.ts';
import { createSessionStore, resolveDataDir, type SessionStore, type UnresolvedFinding } from '../../lib/session-store.ts';
import type { Finding, SourceFile } from '../../lib/static-engine.ts';
import type { HookInput, HookOutput } from './hook-io.ts';

export const PLUGIN_AGENT_PREFIX = 'nestjs-hexagonal:';
export const PREFIX = '[nestjs-hexagonal]';

export interface HookContext {
  env: Record<string, string | undefined>;
  cwd: string;
  pluginRoot: string;
  fetchImpl?: FetchLike;
  now?: () => number;
  store?: SessionStore;
}

export interface SemanticStats {
  requests: number;
  answered: number;
  findings: number;
  uncertain: number;
  uncalibrated: number;
  undecided: number;
}

export interface HookResult {
  output: HookOutput | null;
  decision: HookDecision;
  ruleIds?: string[];
  path?: string | null;
  semantic?: SemanticStats;
  /** Raw bodies the output must never contain verbatim (file contents, replacements). */
  bodies?: string[];
  stderr?: string;
}

export type HookHandler = (input: HookInput, context: HookContext) => Promise<HookResult>;

export function skip(): HookResult {
  return { output: null, decision: 'skip' };
}

export function isPluginAgent(agentType: string | undefined): agentType is string {
  return agentType !== undefined && agentType.startsWith(PLUGIN_AGENT_PREFIX);
}

export function projectDir(input: HookInput, context: HookContext): string {
  return projectDirOf(context.env, input.cwd ?? context.cwd);
}

/** Path relative to the project, or null when the absolute path is outside it. */
export function relativeProjectPath(project: string, absolute: string): string | null {
  const root = normalizePath(project).replace(/\/+$/, '');
  const target = normalizePath(absolute);
  if (target === root) {
    return null;
  }
  if (!target.startsWith(`${root}/`)) {
    return null;
  }
  const relative = target.slice(root.length + 1);
  return relative.split('/').includes('..') ? null : relative;
}

export function sessionStore(context: HookContext): SessionStore {
  return context.store ?? createSessionStore({ dataDir: resolveDataDir(context.env), ...(context.now ? { now: context.now } : {}) });
}

export type LoadedRulebookResult = { ok: true; composed: ComposedRulebook } | { ok: false; reason: string };

export function loadRulebook(input: HookInput, context: HookContext): LoadedRulebookResult {
  try {
    const { composed } = loadProjectRulebook({ cwd: projectDir(input, context), env: context.env, pluginRoot: context.pluginRoot });
    return { ok: true, composed };
  } catch (error) {
    if (error instanceof RulebookNotFoundError || error instanceof RulebookCompositionError) {
      return { ok: false, reason: error.message };
    }
    throw error;
  }
}

export function staticRules(rules: Rule[], options: { external: boolean }): Rule[] {
  return rules.filter((rule) => rule.class === 'static' && rule.check !== undefined && (options.external || rule.check.kind !== 'external'));
}

export function rulesInScope(rules: Rule[], path: string): Rule[] {
  return rules.filter((rule) => isInScope(rule.scope, path));
}

export function apiKey(env: Record<string, string | undefined>): string | undefined {
  const fromOption = env.CLAUDE_PLUGIN_OPTION_TYPESAFE_API_KEY;
  if (fromOption !== undefined && fromOption !== '') {
    return fromOption;
  }
  const fromEnv = env.TYPESAFE_API_KEY;
  return fromEnv !== undefined && fromEnv !== '' ? fromEnv : undefined;
}

function location(finding: { path: string; line?: number }): string {
  return finding.line === undefined ? finding.path : `${finding.path}:${finding.line}`;
}

export function formatStaticFinding(finding: Finding | UnresolvedFinding): string {
  return `${PREFIX} ${finding.ruleId} (${finding.severity}) ${location(finding)}: ${finding.evidence} - fix: ${finding.fix}`;
}

export function formatSemanticFinding(finding: SemanticFinding): string {
  const calibration = finding.calibrated ? '' : ', not calibrated';
  return `${PREFIX} semantic ${finding.decision} ${finding.ruleId} (${finding.severity}) ${location(finding)}: ${finding.evidence}${calibration} - fix: ${finding.fix}`;
}

export function toUnresolved(finding: Finding): UnresolvedFinding {
  const unresolved: UnresolvedFinding = { path: finding.path, ruleId: finding.ruleId, severity: finding.severity, evidence: finding.evidence, fix: finding.fix };
  if (finding.line !== undefined) {
    unresolved.line = finding.line;
  }
  return unresolved;
}

export function uniqueRuleIds(findings: Array<{ ruleId: string }>): string[] {
  return [...new Set(findings.map((finding) => finding.ruleId))].sort();
}

export interface SemanticAdvisory {
  lines: string[];
  stats: SemanticStats;
  findings: SemanticFinding[];
}

export const SEMANTIC_TIMEOUT_MS = 6_000;

/**
 * Semantic rules as advisory text. Never denies or blocks in this version:
 * advise/ask findings become lines, uncertain/uncalibrated ones a single
 * short line, and any client error is swallowed into the stats.
 */
export async function semanticAdvisory(
  composed: ComposedRulebook,
  files: SourceFile[],
  key: string,
  context: HookContext,
  concurrency: number,
): Promise<SemanticAdvisory> {
  const rules = composed.rules.filter((rule) => rule.class === 'semantic');
  const stats: SemanticStats = { requests: 0, answered: 0, findings: 0, uncertain: 0, uncalibrated: 0, undecided: 0 };
  if (rules.length === 0 || files.length === 0) {
    return { lines: [], stats, findings: [] };
  }
  const pin = composed.rulebook.model.pin;
  const loaded = loadFitted(join(context.pluginRoot, 'calibration', 'fitted'), pin, semanticRulebookVersion(composed));
  const fitted: FittedFile | null = loaded.status === 'none' ? null : loaded.fitted;
  const dataDir = resolveDataDir(context.env);
  const client = createJevClient({
    apiKey: key,
    pin,
    rulebookVersion: composed.rulebook.version,
    timeoutMs: SEMANTIC_TIMEOUT_MS,
    cacheDir: join(dataDir, 'cache'),
    logPath: join(dataDir, 'jev.jsonl'),
    breakerPath: join(dataDir, 'breaker.json'),
    ...(context.fetchImpl ? { fetchImpl: context.fetchImpl } : {}),
  });
  const result = await runSemanticRules(rules, files, { client, fitted, uncalibrated: composed.uncalibrated || loaded.status === 'mismatch', concurrency });
  const applied = Object.values(result.applied).reduce((sum, ids) => sum + ids.length, 0);
  const undecided = result.undecided.reduce((sum, entry) => sum + entry.ruleIds.length, 0);
  stats.requests = result.requests;
  stats.undecided = undecided;
  stats.answered = Math.max(0, applied - undecided);
  const lines: string[] = [];
  const abstained: SemanticFinding[] = [];
  for (const finding of result.findings) {
    if (finding.decision === 'uncertain' || finding.decision === 'uncalibrated') {
      abstained.push(finding);
      if (finding.decision === 'uncertain') {
        stats.uncertain += 1;
      } else {
        stats.uncalibrated += 1;
      }
      continue;
    }
    stats.findings += 1;
    lines.push(formatSemanticFinding(finding));
  }
  if (abstained.length > 0) {
    lines.push(`${PREFIX} semantic abstained on ${abstained.length} rule answer(s) (${uniqueRuleIds(abstained).join(', ')}); no action needed`);
  }
  return { lines, stats, findings: result.findings };
}

export function logFields(input: HookInput, hook: string, decision: HookDecision, result: HookResult): Omit<HookLogEntry, 'ts' | 'latencyMs' | 'binarySource' | 'version'> {
  const semantic = result.semantic;
  return {
    hook,
    event: input.hook_event_name,
    agentType: input.agent_type ?? null,
    tool: input.tool_name ?? null,
    path: result.path ?? null,
    ruleIds: result.ruleIds ?? [],
    decision,
    ...(semantic ? { semantic } : {}),
  };
}
