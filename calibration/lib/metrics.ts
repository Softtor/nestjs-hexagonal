import type { FittedThresholds } from '../../scripts/lib/decide.ts';
import type { ResultRecord } from './results.ts';

export const REPORT_CUTS = [0.55, 0.7, 0.8, 0.9] as const;
export const FIT_GRID = Array.from({ length: 10 }, (_, index) => Number((0.5 + index * 0.05).toFixed(2)));
export const ASK_MIN_PRECISION = 0.85;
export const DENY_MIN_PRECISION = 0.95;
export const DENY_MIN_SAMPLES = 30;
export const DEFAULT_BAND_HI = 0.65;

export interface Interval {
  lo: number;
  hi: number;
}

export interface CutMetrics {
  cut: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  precisionInterval: Interval;
  recall: number;
  recallInterval: Interval;
  f1: number;
  falsePositives: string[];
  misses: string[];
}

export interface RuleMetrics {
  ruleId: string;
  primitive: ResultRecord['primitive'];
  nGood: number;
  nBad: number;
  errors: number;
  models: string[];
  cuts: CutMetrics[];
  uncertainRate: number;
  latency: { p50: number; p95: number };
  inputTokens: number;
}

export interface UncertainBand {
  lo: number;
  hi: number;
}

export interface FitInput {
  ruleId: string;
  records: ResultRecord[];
  uncertain?: UncertainBand;
  minConfidence?: number;
}

export interface FitResult {
  metrics: RuleMetrics;
  fitted: FittedThresholds;
  denyReason: string | null;
  floor: number;
}

export function wilson(successes: number, n: number, z = 1.96): Interval {
  if (n === 0) {
    return { lo: 0, hi: 1 };
  }
  const p = successes / n;
  const denominator = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { lo: Math.max(0, (centre - spread) / denominator), hi: Math.min(1, (centre + spread) / denominator) };
}

export function percentile(values: number[], fraction: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index] ?? 0;
}

export function metricsAtCut(records: ResultRecord[], cut: number): CutMetrics {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  const falsePositives: string[] = [];
  const misses: string[] = [];
  for (const record of records) {
    const flagged = record.value >= cut;
    if (record.expected === 'violation') {
      if (flagged) {
        tp += 1;
      } else {
        fn += 1;
        misses.push(record.caseId);
      }
    } else if (flagged) {
      fp += 1;
      falsePositives.push(record.caseId);
    } else {
      tn += 1;
    }
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    cut,
    tp,
    fp,
    fn,
    tn,
    precision,
    precisionInterval: wilson(tp, tp + fp),
    recall,
    recallInterval: wilson(tp, tp + fn),
    f1,
    falsePositives: falsePositives.sort(),
    misses: misses.sort(),
  };
}

function isUncertain(record: ResultRecord, band: UncertainBand, minConfidence: number): boolean {
  if (record.primitive === 'noul') {
    return record.value >= band.lo && record.value <= band.hi;
  }
  return (record.confidence ?? 0) < minConfidence;
}

export function cutFloor(input: FitInput): number {
  return input.uncertain?.hi ?? DEFAULT_BAND_HI;
}

export function computeRuleMetrics(input: FitInput): RuleMetrics {
  const usable = input.records.filter((record) => record.error === undefined);
  const primitive = usable[0]?.primitive ?? input.records[0]?.primitive ?? 'noul';
  const band = input.uncertain ?? { lo: 0.35, hi: 0.65 };
  const minConfidence = input.minConfidence ?? 0.6;
  const uncertain = usable.filter((record) => isUncertain(record, band, minConfidence)).length;
  const latencies = usable.filter((record) => !record.cached).map((record) => record.latencyMs);
  return {
    ruleId: input.ruleId,
    primitive,
    nGood: usable.filter((record) => record.expected === 'ok').length,
    nBad: usable.filter((record) => record.expected === 'violation').length,
    errors: input.records.length - usable.length,
    models: [...new Set(input.records.map((record) => record.model))].sort(),
    cuts: [...new Set([...REPORT_CUTS, ...FIT_GRID, cutFloor(input)])].sort((a, b) => a - b).map((cut) => metricsAtCut(usable, cut)),
    uncertainRate: usable.length === 0 ? 0 : uncertain / usable.length,
    latency: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
    inputTokens: usable.reduce((sum, record) => sum + record.inputTokens, 0),
  };
}

function sameOutcome(a: CutMetrics, b: CutMetrics): boolean {
  return a.tp === b.tp && a.fp === b.fp;
}

function highestOfPlateau(candidates: CutMetrics[], start: CutMetrics): CutMetrics {
  let chosen = start;
  for (const entry of candidates) {
    if (entry.cut > chosen.cut && sameOutcome(entry, start)) {
      chosen = entry;
    }
  }
  return chosen;
}

export function fitRule(input: FitInput): FitResult {
  const metrics = computeRuleMetrics(input);
  const floor = cutFloor(input);
  const grid = metrics.cuts.filter((entry) => entry.cut >= floor && (FIT_GRID.includes(entry.cut) || entry.cut === floor));
  const fitted: FittedThresholds = {};
  const usable = grid.filter((entry) => entry.tp > 0);

  const best = usable.reduce<CutMetrics | null>((current, entry) => (current === null || entry.f1 > current.f1 ? entry : current), null);
  if (best) {
    fitted.advise = best.cut;
  }
  const askFloor = fitted.advise ?? floor;
  const firstAsk = usable.find((entry) => entry.cut >= askFloor && entry.precision >= ASK_MIN_PRECISION);
  if (firstAsk) {
    fitted.ask = highestOfPlateau(usable, firstAsk).cut;
  }

  let denyReason: string | null = null;
  if (metrics.nGood < DENY_MIN_SAMPLES || metrics.nBad < DENY_MIN_SAMPLES) {
    denyReason = `needs at least ${DENY_MIN_SAMPLES} good and ${DENY_MIN_SAMPLES} bad cases (have ${metrics.nGood}/${metrics.nBad})`;
  } else {
    const denyFloor = fitted.ask ?? askFloor;
    const firstDeny = usable.find((entry) => entry.cut >= denyFloor && entry.precision >= DENY_MIN_PRECISION && entry.fp === 0);
    if (firstDeny) {
      fitted.deny = highestOfPlateau(usable, firstDeny).cut;
    } else {
      denyReason = `no cut reaches precision ${DENY_MIN_PRECISION} with zero false positives`;
    }
  }

  if (metrics.primitive === 'noul') {
    fitted.uncertain = input.uncertain ?? { lo: 0.35, hi: 0.65 };
  } else {
    fitted.minConfidence = input.minConfidence ?? 0.6;
  }
  return { metrics, fitted, denyReason, floor };
}
