import '../../scripts/__tests__/helpers/no-network.ts';
import { assertNetworkForbidden } from '../../scripts/__tests__/helpers/no-network.ts';
import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readRulebookFile } from '../../scripts/lib/compose.ts';
import type { JevAnswer, JevClient, JevRequest } from '../../scripts/lib/jev-client.ts';
import { loadGoldenCases } from '../lib/golden.ts';
import { readResults } from '../lib/results.ts';
import { parseRunArgs, runCalibration } from '../run.ts';

const PLUGIN_ROOT = resolve(import.meta.dir, '../..');
const GOLDEN_ROOT = join(PLUGIN_ROOT, 'calibration', 'golden');
const { rulebook } = readRulebookFile(join(PLUGIN_ROOT, 'rulebooks', 'hexagonal.rulebook.yaml'));
const semanticRules = rulebook.rules.filter((rule) => rule.class === 'semantic');

function fakeClient(requests: JevRequest[] = []): JevClient {
  return {
    ask(request) {
      requests.push(request);
      const answers: Record<string, JevAnswer> = {};
      for (const [key, question] of Object.entries(request.questions)) {
        const violation = typeof request.state === 'object' && request.state !== null && !Array.isArray(request.state) && String(request.state.path).includes('/bad/');
        answers[key] = question.type === 'choice'
          ? { type: 'choice', choice: violation ? 'trivial-use-case' : 'none', confidence: 0.9, probabilities: violation ? { 'trivial-use-case': 0.9, none: 0.1 } : { none: 0.9, other: 0.1 } }
          : { type: 'noul', noul: violation ? 0.9 : 0.1 };
      }
      return Promise.resolve({ ok: true, answers, model: 'jev-1.13.0', usage: { inputTokens: 400, outputTokens: 3 }, latencyMs: 250, cached: false, uncalibrated: false });
    },
  };
}

describe('runCalibration', () => {
  it('sends every golden case of the rule once and writes one JSONL per rule without the state text', async () => {
    const rule = semanticRules.find((entry) => entry.id === 'hex/controller-thin');
    expect(rule).toBeDefined();
    if (!rule) return;
    const outDir = mkdtempSync(join(tmpdir(), 'calibration-out-'));
    const requests: JevRequest[] = [];
    const result = await runCalibration({ rules: [rule], goldenRoot: GOLDEN_ROOT, pluginRoot: PLUGIN_ROOT, outDir, pin: 'jev-1.13.0', client: fakeClient(requests) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cases = loadGoldenCases(GOLDEN_ROOT, rule.id, PLUGIN_ROOT);
    expect(result.requests).toBe(cases.length);
    expect(requests).toHaveLength(cases.length);
    expect(result.files).toEqual([join(outDir, 'hex', 'controller-thin.jsonl')]);
    const records = readResults(result.files[0] ?? '');
    expect(records).toHaveLength(cases.length);
    expect(records.every((record) => record.model === 'jev-1.13.0' && record.primitive === 'noul')).toBe(true);
    expect(records.filter((record) => record.expected === 'violation').every((record) => record.value === 0.9)).toBe(true);
    expect(records.filter((record) => record.expected === 'ok').every((record) => record.value === 0.1)).toBe(true);
    const raw = readFileSync(result.files[0] ?? '', 'utf8');
    expect(raw).not.toContain('@Controller');
    expect(raw).not.toContain('import ');
    assertNetworkForbidden();
  });

  it('records choice answers with the violating mass and the confidence', async () => {
    const rule = semanticRules.find((entry) => entry.id === 'hex/no-overengineering');
    if (!rule) throw new Error('rule missing');
    const outDir = mkdtempSync(join(tmpdir(), 'calibration-out-'));
    const result = await runCalibration({ rules: [rule], goldenRoot: GOLDEN_ROOT, pluginRoot: PLUGIN_ROOT, outDir, pin: 'jev-1.13.0', client: fakeClient() });
    if (!result.ok) throw new Error(result.error);
    const records = result.records.get(rule.id) ?? [];
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((record) => record.primitive === 'choice' && record.confidence === 0.9)).toBe(true);
    expect(records.find((record) => record.expected === 'violation')?.value).toBeCloseTo(0.9);
  });

  it('aborts before sending anything when the golden set exceeds the request budget', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'calibration-out-'));
    const requests: JevRequest[] = [];
    const result = await runCalibration({ rules: semanticRules, goldenRoot: GOLDEN_ROOT, pluginRoot: PLUGIN_ROOT, outDir, pin: 'jev-1.13.0', client: fakeClient(requests), maxRequests: 10 });
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.error).toContain('budget guard');
    expect(requests).toHaveLength(0);
  });

  it('keeps client errors as records with an error field', async () => {
    const rule = semanticRules.find((entry) => entry.id === 'hex/port-no-infra-leak');
    if (!rule) throw new Error('rule missing');
    const failing: JevClient = { ask: () => Promise.resolve({ ok: false, error: 'timeout', detail: 'no response within 15000 ms' }) };
    const outDir = mkdtempSync(join(tmpdir(), 'calibration-out-'));
    const result = await runCalibration({ rules: [rule], goldenRoot: GOLDEN_ROOT, pluginRoot: PLUGIN_ROOT, outDir, pin: 'jev-1.13.0', client: failing });
    if (!result.ok) throw new Error(result.error);
    expect(result.errors).toBe(result.requests);
    expect((result.records.get(rule.id) ?? [])[0]?.error).toBe('timeout: no response within 15000 ms');
  });
});

describe('runCalibration resilience', () => {
  const rule = semanticRules.find((entry) => entry.id === 'hex/no-overengineering');

  it('records a mismatched primitive and a throwing client as error records without aborting the run', async () => {
    if (!rule) throw new Error('rule missing');
    let calls = 0;
    const flaky: JevClient = {
      ask(request) {
        calls += 1;
        if (calls === 1) {
          const answers: Record<string, JevAnswer> = {};
          for (const key of Object.keys(request.questions)) {
            answers[key] = { type: 'noul', noul: 0.9 };
          }
          return Promise.resolve({ ok: true, answers, model: 'jev-1.13.0', usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1, cached: false, uncalibrated: false });
        }
        return Promise.reject(new Error('socket hang up'));
      },
    };
    const outDir = mkdtempSync(join(tmpdir(), 'calibration-out-'));
    const result = await runCalibration({ rules: [rule], goldenRoot: GOLDEN_ROOT, pluginRoot: PLUGIN_ROOT, outDir, pin: 'jev-1.13.0', client: flaky, concurrency: 1 });
    if (!result.ok) throw new Error(result.error);
    const cases = loadGoldenCases(GOLDEN_ROOT, rule.id, PLUGIN_ROOT);
    const records = readResults(result.files[0] ?? '');
    expect(records).toHaveLength(cases.length);
    expect(result.errors).toBe(cases.length);
    expect(records.filter((record) => record.error === 'answer type noul does not match question type choice')).toHaveLength(1);
    expect(records.filter((record) => record.error === 'socket hang up')).toHaveLength(cases.length - 1);
  });

  it('appends each record to the JSONL as soon as it arrives', async () => {
    if (!rule) throw new Error('rule missing');
    const outDir = mkdtempSync(join(tmpdir(), 'calibration-out-'));
    const path = join(outDir, 'hex', 'no-overengineering.jsonl');
    const seen: number[] = [];
    const observing: JevClient = {
      ask(request) {
        seen.push(existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter((line) => line !== '').length : 0);
        return fakeClient().ask(request);
      },
    };
    await runCalibration({ rules: [rule], goldenRoot: GOLDEN_ROOT, pluginRoot: PLUGIN_ROOT, outDir, pin: 'jev-1.13.0', client: observing, concurrency: 1 });
    expect(seen.slice(0, 3)).toEqual([0, 1, 2]);
  });
});

describe('parseRunArgs', () => {
  it('defaults to all rules, the pinned model, 500 requests and concurrency 4', () => {
    expect(parseRunArgs([])).toEqual({ rule: 'all', pin: 'jev-1.13.0', maxRequests: 500, concurrency: 4 });
    expect(parseRunArgs(['--rule', 'hex/controller-thin', '--max-requests', '40', '--out', 'x'])).toMatchObject({ rule: 'hex/controller-thin', maxRequests: 40, out: 'x' });
    expect(() => parseRunArgs(['--max-requests', '0'])).toThrow();
  });
});
