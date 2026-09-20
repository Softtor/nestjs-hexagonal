import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const HOOK_DECISIONS = ['skip', 'silent', 'context', 'deny', 'block', 'release', 'error'] as const;

export const HookLogEntrySchema = z.object({
  ts: z.string(),
  hook: z.string(),
  event: z.string(),
  agentType: z.string().nullable(),
  tool: z.string().nullable(),
  path: z.string().nullable(),
  ruleIds: z.array(z.string()),
  decision: z.enum(HOOK_DECISIONS),
  latencyMs: z.number().nonnegative(),
  binarySource: z.string().nullable(),
  version: z.string(),
  semantic: z
    .object({
      requests: z.number().int().nonnegative(),
      answered: z.number().int().nonnegative(),
      findings: z.number().int().nonnegative(),
      uncertain: z.number().int().nonnegative(),
      uncalibrated: z.number().int().nonnegative(),
      undecided: z.number().int().nonnegative(),
    })
    .optional(),
});

export type HookLogEntry = z.infer<typeof HookLogEntrySchema>;
export type HookDecision = HookLogEntry['decision'];

const LOG_FILE = /^hooks-(\d{8})\.jsonl$/;

export function logsDir(dataDir: string): string {
  return join(dataDir, 'logs');
}

function dayStamp(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

export function appendHookLog(dataDir: string, entry: HookLogEntry): void {
  const dir = logsDir(dataDir);
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `hooks-${dayStamp(new Date(entry.ts))}.jsonl`), `${JSON.stringify(entry)}\n`);
}

export function readHookLogs(dataDir: string, since: Date): HookLogEntry[] {
  const dir = logsDir(dataDir);
  if (!existsSync(dir)) {
    return [];
  }
  const sinceStamp = dayStamp(since);
  const entries: HookLogEntry[] = [];
  for (const name of readdirSync(dir).sort()) {
    const match = LOG_FILE.exec(name);
    if (!match || match[1] < sinceStamp) {
      continue;
    }
    for (const line of readFileSync(join(dir, name), 'utf8').split('\n')) {
      if (line.trim() === '') {
        continue;
      }
      try {
        const parsed = HookLogEntrySchema.safeParse(JSON.parse(line));
        if (parsed.success && new Date(parsed.data.ts) >= since) {
          entries.push(parsed.data);
        }
      } catch {
        continue;
      }
    }
  }
  return entries;
}

export interface HookAggregate {
  entries: number;
  p50Ms: number;
  p95Ms: number;
  decisions: Record<string, number>;
}

export interface SemanticAggregate {
  requests: number;
  answered: number;
  findings: number;
  uncertain: number;
  uncalibrated: number;
  undecided: number;
  uncertainRate: number;
  uncalibratedRate: number;
}

export interface HookLogSummary {
  since: string;
  until: string;
  entries: number;
  hooks: Record<string, HookAggregate>;
  decisions: Record<string, number>;
  binarySources: Record<string, number>;
  semantic: SemanticAggregate;
}

export function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index] ?? 0;
}

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

export function summarizeHookLogs(entries: HookLogEntry[], since: Date, until: Date): HookLogSummary {
  const byHook = new Map<string, HookLogEntry[]>();
  const decisions: Record<string, number> = {};
  const binarySources: Record<string, number> = {};
  const semantic = { requests: 0, answered: 0, findings: 0, uncertain: 0, uncalibrated: 0, undecided: 0 };
  for (const entry of entries) {
    const group = byHook.get(entry.hook) ?? [];
    group.push(entry);
    byHook.set(entry.hook, group);
    bump(decisions, entry.decision);
    bump(binarySources, entry.binarySource ?? 'unknown');
    if (entry.semantic) {
      semantic.requests += entry.semantic.requests;
      semantic.answered += entry.semantic.answered;
      semantic.findings += entry.semantic.findings;
      semantic.uncertain += entry.semantic.uncertain;
      semantic.uncalibrated += entry.semantic.uncalibrated;
      semantic.undecided += entry.semantic.undecided;
    }
  }
  const hooks: Record<string, HookAggregate> = {};
  for (const [hook, group] of [...byHook.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const latencies = group.map((entry) => entry.latencyMs).sort((a, b) => a - b);
    const hookDecisions: Record<string, number> = {};
    for (const entry of group) {
      bump(hookDecisions, entry.decision);
    }
    hooks[hook] = { entries: group.length, p50Ms: percentile(latencies, 0.5), p95Ms: percentile(latencies, 0.95), decisions: hookDecisions };
  }
  const answeredOrUndecided = semantic.answered + semantic.undecided;
  return {
    since: since.toISOString(),
    until: until.toISOString(),
    entries: entries.length,
    hooks,
    decisions,
    binarySources,
    semantic: {
      ...semantic,
      uncertainRate: answeredOrUndecided === 0 ? 0 : semantic.uncertain / answeredOrUndecided,
      uncalibratedRate: answeredOrUndecided === 0 ? 0 : semantic.uncalibrated / answeredOrUndecided,
    },
  };
}
