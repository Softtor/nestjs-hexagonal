import './helpers/no-network.ts';
import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runCli, type CliIo } from '../check.ts';
import { appendHookLog, percentile, readHookLogs, summarizeHookLogs, type HookLogEntry } from '../lib/hook-log.ts';

const PLUGIN_ROOT = resolve(import.meta.dir, '../..');

function entry(overrides: Partial<HookLogEntry>): HookLogEntry {
  return {
    ts: '2026-09-20T10:00:00.000Z',
    hook: 'pre-tool-use',
    event: 'PreToolUse',
    agentType: 'nestjs-hexagonal:domain-agent',
    tool: 'Write',
    path: 'src/orders/domain/order.entity.ts',
    ruleIds: [],
    decision: 'silent',
    latencyMs: 10,
    binarySource: 'plugin-root',
    version: '1.3.0-dev.0',
    ...overrides,
  };
}

function capture(): CliIo & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (text) => void out.push(text), stderr: (text) => void err.push(text) };
}

interface Summary {
  entries: number;
  hooks: Record<string, { entries: number; p50Ms: number; p95Ms: number; decisions: Record<string, number> }>;
  decisions: Record<string, number>;
  binarySources: Record<string, number>;
  semantic: { requests: number; uncertain: number; uncalibrated: number; uncertainRate: number; uncalibratedRate: number };
}

function isSummary(value: unknown): value is Summary {
  return typeof value === 'object' && value !== null && 'hooks' in value && 'semantic' in value;
}

describe('hook log', () => {
  it('appends one JSONL line per decision into a file named by day', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hex-log-'));
    appendHookLog(dataDir, entry({}));
    appendHookLog(dataDir, entry({ ts: '2026-09-21T01:00:00.000Z', decision: 'deny', ruleIds: ['hex/domain-no-nest-decorators'] }));
    expect(readdirSync(join(dataDir, 'logs')).sort()).toEqual(['hooks-20260920.jsonl', 'hooks-20260921.jsonl']);
    const lines = readFileSync(join(dataDir, 'logs', 'hooks-20260921.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ decision: 'deny', ruleIds: ['hex/domain-no-nest-decorators'] });
  });

  it('reads only entries since the given date and skips malformed lines', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hex-log-'));
    appendHookLog(dataDir, entry({ ts: '2026-09-19T23:00:00.000Z' }));
    appendHookLog(dataDir, entry({ ts: '2026-09-20T09:00:00.000Z' }));
    appendHookLog(dataDir, entry({ ts: '2026-09-20T11:00:00.000Z' }));
    const file = join(dataDir, 'logs', 'hooks-20260920.jsonl');
    const broken = `${readFileSync(file, 'utf8')}not json\n{"ts":"2026-09-20T12:00:00.000Z"}\n`;
    writeFileSync(file, broken);
    const entries = readHookLogs(dataDir, new Date('2026-09-20T10:00:00.000Z'));
    expect(entries.map((item) => item.ts)).toEqual(['2026-09-20T11:00:00.000Z']);
    expect(readHookLogs(join(dataDir, 'missing'), new Date(0))).toEqual([]);
  });

  it('computes nearest-rank percentiles', () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([5], 0.95)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
    expect(percentile([1, 2, 3, 4], 0.95)).toBe(4);
  });

  it('aggregates latency per hook, decisions by kind and semantic rates', () => {
    const entries = [
      entry({ latencyMs: 10, decision: 'silent' }),
      entry({ latencyMs: 30, decision: 'deny', ruleIds: ['hex/domain-no-nest-decorators'] }),
      entry({ latencyMs: 20, decision: 'context' }),
      entry({ hook: 'subagent-stop', event: 'SubagentStop', tool: null, path: null, latencyMs: 900, decision: 'block', binarySource: 'node_modules', semantic: { requests: 2, answered: 4, findings: 2, uncertain: 1, uncalibrated: 0, undecided: 1 } }),
      entry({ hook: 'subagent-stop', event: 'SubagentStop', tool: null, path: null, latencyMs: 400, decision: 'release', binarySource: null, semantic: { requests: 1, answered: 3, findings: 1, uncertain: 0, uncalibrated: 1, undecided: 0 } }),
    ];
    const summary = summarizeHookLogs(entries, new Date('2026-09-20T00:00:00.000Z'), new Date('2026-09-21T00:00:00.000Z'));
    expect(summary.entries).toBe(5);
    expect(summary.hooks['pre-tool-use']).toEqual({ entries: 3, p50Ms: 20, p95Ms: 30, decisions: { silent: 1, deny: 1, context: 1 } });
    expect(summary.hooks['subagent-stop']).toEqual({ entries: 2, p50Ms: 400, p95Ms: 900, decisions: { block: 1, release: 1 } });
    expect(summary.decisions).toEqual({ silent: 1, deny: 1, context: 1, block: 1, release: 1 });
    expect(summary.binarySources).toEqual({ 'plugin-root': 3, node_modules: 1, unknown: 1 });
    expect(summary.semantic).toEqual({ requests: 3, answered: 7, findings: 3, uncertain: 1, uncalibrated: 1, undecided: 1, uncertainRate: 1 / 8, uncalibratedRate: 1 / 8 });
  });

  it('export-logs writes the summary of a fixture log to --out', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hex-log-'));
    appendHookLog(dataDir, entry({ latencyMs: 12 }));
    appendHookLog(dataDir, entry({ latencyMs: 48, decision: 'deny', ruleIds: ['hex/vo-immutable'] }));
    const out = join(dataDir, 'weekly.json');
    const io = capture();
    const code = await runCli(['export-logs', '--since', '2026-09-20', '--out', out], io, { cwd: dataDir, env: { CLAUDE_PLUGIN_DATA: dataDir }, pluginRoot: PLUGIN_ROOT });
    expect(code).toBe(0);
    expect(io.out).toEqual([]);
    expect(io.err.join('')).toContain('wrote 2 entries');
    expect(existsSync(out)).toBe(true);
    const parsed: unknown = JSON.parse(readFileSync(out, 'utf8'));
    if (!isSummary(parsed)) {
      throw new Error('summary shape');
    }
    expect(parsed.entries).toBe(2);
    expect(parsed.hooks['pre-tool-use']?.p95Ms).toBe(48);
    expect(parsed.decisions).toEqual({ silent: 1, deny: 1 });

    const stdoutIo = capture();
    expect(await runCli(['export-logs', '--since', '2026-09-20'], stdoutIo, { cwd: dataDir, env: { CLAUDE_PLUGIN_DATA: dataDir }, pluginRoot: PLUGIN_ROOT })).toBe(0);
    expect(stdoutIo.out.join('')).toContain('"entries": 2');

    const usage = capture();
    expect(await runCli(['export-logs'], usage, { cwd: dataDir, env: {}, pluginRoot: PLUGIN_ROOT })).toBe(2);
    expect(usage.err.join('')).toContain('--since');
  });
});
