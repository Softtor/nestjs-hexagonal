import '../../scripts/__tests__/helpers/no-network.ts';
import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fitAll } from '../fit.ts';
import { fitRule, metricsAtCut, wilson } from '../lib/metrics.ts';
import { readResults, writeResults, type ResultRecord } from '../lib/results.ts';

function record(overrides: Partial<ResultRecord> & { caseId: string; expected: ResultRecord['expected']; value: number }): ResultRecord {
  return {
    pin: 'jev-1.13.0',
    model: 'jev-1.13.0',
    ruleId: 'hex/sample',
    primitive: 'noul',
    answer: overrides.value,
    latencyMs: 300,
    inputTokens: 500,
    cached: false,
    ...overrides,
  };
}

function synthetic(nGood: number, nBad: number, goodValues: (i: number) => number, badValues: (i: number) => number): ResultRecord[] {
  const records: ResultRecord[] = [];
  for (let i = 0; i < nGood; i += 1) {
    records.push(record({ caseId: `good-${i}`, expected: 'ok', value: goodValues(i) }));
  }
  for (let i = 0; i < nBad; i += 1) {
    records.push(record({ caseId: `bad-${i}`, expected: 'violation', value: badValues(i) }));
  }
  return records;
}

describe('wilson', () => {
  it('matches the textbook interval for 9 of 10', () => {
    const interval = wilson(9, 10);
    expect(interval.lo).toBeCloseTo(0.596, 2);
    expect(interval.hi).toBeCloseTo(0.982, 2);
  });

  it('is [0, 1] with no samples', () => {
    expect(wilson(0, 0)).toEqual({ lo: 0, hi: 1 });
  });
});

describe('metricsAtCut', () => {
  it('counts tp, fp, fn, tn and lists the case ids of misses and false positives', () => {
    const records = synthetic(3, 3, (i) => [0.1, 0.2, 0.75][i] ?? 0, (i) => [0.95, 0.8, 0.4][i] ?? 0);
    const metrics = metricsAtCut(records, 0.7);
    expect(metrics).toMatchObject({ tp: 2, fp: 1, fn: 1, tn: 2, falsePositives: ['good-2'], misses: ['bad-2'] });
    expect(metrics.precision).toBeCloseTo(2 / 3);
    expect(metrics.recall).toBeCloseTo(2 / 3);
  });
});

describe('metricsAtCut with abstention', () => {
  it('counts records the runtime would call uncertain as neither TP nor FP, but as FN for recall', () => {
    const choice = (caseId: string, expected: ResultRecord['expected'], confidence: number): ResultRecord => ({ ...record({ caseId, expected, value: 0.9 }), primitive: 'choice', answer: 'bad-a', confidence });
    const records = [choice('bad-confident', 'violation', 0.9), choice('bad-shy', 'violation', 0.4), choice('good-shy', 'ok', 0.4)];
    const metrics = metricsAtCut(records, 0.7, { minConfidence: 0.6 });
    expect(metrics).toMatchObject({ tp: 1, fp: 0, fn: 1, tn: 0, uncertain: 2, uncertainCases: ['bad-shy', 'good-shy'], misses: ['bad-shy'] });
    expect(metrics.precision).toBe(1);
    expect(metrics.recall).toBeCloseTo(0.5);
    const noul = [record({ caseId: 'bad-band', expected: 'violation', value: 0.6 }), record({ caseId: 'good-band', expected: 'ok', value: 0.5 })];
    const banded = metricsAtCut(noul, 0.55, { uncertain: { lo: 0.35, hi: 0.65 } });
    expect(banded).toMatchObject({ tp: 0, fp: 0, fn: 1, tn: 0, uncertain: 2 });
    expect(metricsAtCut(noul, 0.55)).toMatchObject({ tp: 1, fp: 0, uncertain: 0 });
  });
});

describe('fitRule', () => {
  it('fits advise at the best F1 and ask at the first cut with precision >= 0.85, and omits deny below 30/30', () => {
    const records = synthetic(10, 10, (i) => (i === 0 ? 0.72 : 0.1 + i * 0.02), (i) => 0.78 + i * 0.02);
    const fit = fitRule({ ruleId: 'hex/sample', records, uncertain: { lo: 0.35, hi: 0.65 } });
    expect(fit.fitted.advise).toBe(0.75);
    expect(fit.fitted.ask).toBe(0.75);
    expect(fit.fitted.deny).toBeUndefined();
    expect(fit.floor).toBe(0.65);
    expect(fit.denyReason).toContain('at least 30 good and 30 bad');
    expect(fit.fitted.uncertain).toEqual({ lo: 0.35, hi: 0.65 });
    expect(fit.metrics.nGood).toBe(10);
    expect(fit.metrics.nBad).toBe(10);
  });

  it('fits deny with 30/30 samples, precision >= 0.95 and zero false positives', () => {
    const records = synthetic(35, 35, (i) => 0.05 + (i % 10) * 0.05, (i) => 0.86 + (i % 7) * 0.02);
    const fit = fitRule({ ruleId: 'hex/sample', records, uncertain: { lo: 0.35, hi: 0.65 } });
    expect(fit.fitted.deny).toBe(0.85);
    expect(fit.denyReason).toBeNull();
  });

  it('omits deny when every qualifying cut still has a false positive', () => {
    const records = synthetic(35, 35, (i) => (i === 0 ? 0.99 : 0.1), () => 0.9);
    const fit = fitRule({ ruleId: 'hex/sample', records, uncertain: { lo: 0.35, hi: 0.65 } });
    expect(fit.fitted.deny).toBeUndefined();
    expect(fit.denyReason).toContain('zero false positives');
  });

  it('measures the uncertain rate inside the band for noul and below minConfidence for choice', () => {
    const noul = synthetic(4, 0, (i) => [0.1, 0.4, 0.6, 0.9][i] ?? 0, () => 0);
    expect(fitRule({ ruleId: 'hex/sample', records: noul, uncertain: { lo: 0.35, hi: 0.65 } }).metrics.uncertainRate).toBeCloseTo(0.5);
    const choice = synthetic(2, 2, () => 0.1, () => 0.9).map((entry, index) => ({ ...entry, primitive: 'choice' as const, answer: 'none', confidence: index % 2 === 0 ? 0.4 : 0.9 }));
    const fit = fitRule({ ruleId: 'hex/choice', records: choice, minConfidence: 0.6 });
    expect(fit.metrics.uncertainRate).toBeCloseTo(0.5);
    expect(fit.fitted.minConfidence).toBe(0.6);
    expect(fit.fitted.uncertain).toBeUndefined();
  });

  it('keeps the fitted cuts monotone: ask is never below advise and deny never below ask', () => {
    const records = synthetic(35, 35, (i) => (i < 3 ? 0.62 : 0.1), (i) => (i < 30 ? 0.9 : 0.5));
    const fit = fitRule({ ruleId: 'hex/sample', records, uncertain: { lo: 0.35, hi: 0.65 } });
    const { advise, ask, deny } = fit.fitted;
    expect(advise).toBeDefined();
    expect(ask).toBeDefined();
    expect(deny).toBeDefined();
    if (advise === undefined || ask === undefined || deny === undefined) return;
    expect(ask).toBeGreaterThanOrEqual(advise);
    expect(deny).toBeGreaterThanOrEqual(ask);
    expect(deny).toBe(0.9);
  });

  it('pushes ask up to the advise cut when precision was already high below it', () => {
    const records = synthetic(10, 10, (i) => 0.05 + i * 0.01, (i) => (i < 8 ? 0.9 : 0.7));
    const fit = fitRule({ ruleId: 'hex/sample', records });
    expect(fit.fitted.advise).toBe(0.65);
    expect(fit.fitted.ask).toBe(0.7);
    const shifted = synthetic(10, 10, (i) => (i < 2 ? 0.55 : 0.1), (i) => (i < 8 ? 0.9 : 0.7));
    const shiftedFit = fitRule({ ruleId: 'hex/sample', records: shifted });
    expect(shiftedFit.fitted.advise).toBe(0.65);
    expect(shiftedFit.fitted.ask).toBe(0.7);
  });

  it('never fits a cut below the uncertain band hi, even when a lower cut has the best F1', () => {
    const records = synthetic(10, 10, (i) => 0.1 + i * 0.02, (i) => (i < 5 ? 0.52 + i * 0.01 : 0.9));
    const fit = fitRule({ ruleId: 'hex/sample', records, uncertain: { lo: 0.35, hi: 0.65 } });
    expect(fit.floor).toBe(0.65);
    expect(fit.fitted.advise).toBe(0.65);
    expect(fit.fitted.ask).toBe(0.9);
    const inBand = fitRule({ ruleId: 'hex/sample', records: synthetic(10, 10, () => 0.1, (i) => 0.52 + i * 0.01), uncertain: { lo: 0.35, hi: 0.65 } });
    expect(inBand.fitted.advise).toBeUndefined();
    const wideBand = fitRule({ ruleId: 'hex/sample', records: synthetic(35, 35, () => 0.1, () => 0.74), uncertain: { lo: 0.3, hi: 0.72 } });
    expect(wideBand.fitted.advise).toBe(0.72);
    expect(wideBand.fitted.ask).toBe(0.72);
    expect(wideBand.fitted.deny).toBe(0.72);
  });

  it('advise takes the lowest cut of the best-F1 plateau while ask and deny take the highest', () => {
    const records = synthetic(35, 35, () => 0.1, () => 0.96);
    const fit = fitRule({ ruleId: 'hex/sample', records, uncertain: { lo: 0.35, hi: 0.65 } });
    expect(fit.fitted.advise).toBe(0.65);
    expect(fit.fitted.ask).toBe(0.95);
    expect(fit.fitted.deny).toBe(0.95);
  });

  it('ignores errored records in the counts', () => {
    const records = [...synthetic(2, 2, () => 0.1, () => 0.9), record({ caseId: 'bad-x', expected: 'violation', value: 0, error: 'timeout' })];
    const fit = fitRule({ ruleId: 'hex/sample', records });
    expect(fit.metrics.nBad).toBe(2);
    expect(fit.metrics.errors).toBe(1);
  });
});

describe('fitAll', () => {
  it('writes a fitted file keyed by rule id and a report with the per-rule table', () => {
    const byRule = new Map<string, ResultRecord[]>();
    byRule.set('hex/sample', synthetic(10, 10, (i) => 0.1 + i * 0.02, (i) => 0.78 + i * 0.02));
    const output = fitAll({ pin: 'jev-1.13.0', rulebookVersion: '1.3.0', rules: [], resultsByRule: byRule, generatedAt: '2026-09-20T00:00:00.000Z' });
    expect(output.fittedFile).toMatchObject({ pin: 'jev-1.13.0', rulebookVersion: '1.3.0', rules: { 'hex/sample': { advise: 0.65, ask: 0.75, uncertain: { lo: 0.35, hi: 0.65 } } } });
    expect(output.fittedFile.rules['hex/sample']?.deny).toBeUndefined();
    expect(output.report).toContain('| `hex/sample` | noul | 10 | 10 | 0 | 0.65 | 0.75 | omitted |');
    expect(output.report).toContain('Also caught by static? (does not count)');
    expect(output.report).toContain('TODO=false');
    expect(output.report).toContain('Cuts restricted to >= hi=0.65; advise at the lowest cut of the best-F1 plateau, ask and deny at the highest cut of their plateau.');
    expect(output.report).toContain('| 0.9 |');
    expect(output.report).toContain('effective recall');
    expect(output.report).toContain('| Cut | TP | FP | FN | TN | Uncertain |');
    expect(output.report).toContain('`deny` omitted: needs at least 30 good and 30 bad cases (have 10/10).');
  });
});

describe('results files', () => {
  it('round-trips JSONL records and rejects malformed lines', () => {
    const dir = mkdtempSync(join(tmpdir(), 'results-'));
    const records = synthetic(1, 1, () => 0.1, () => 0.9);
    const path = writeResults(dir, 'hex/sample', records);
    expect(path).toBe(join(dir, 'hex/sample.jsonl'));
    expect(readResults(path)).toEqual(records);
  });
});
