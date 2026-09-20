import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { JevAnswer } from './jev-client.ts';
import { formatIssues, type Rule } from './rulebook.schema.ts';

export type Decision = 'deny' | 'ask' | 'advise' | 'pass' | 'uncertain' | 'uncalibrated';

const Probability = z.number().min(0).max(1);

export const FittedThresholdsSchema = z
  .object({
    deny: Probability.optional(),
    ask: Probability.optional(),
    advise: Probability.optional(),
    uncertain: z.object({ lo: Probability, hi: Probability }).optional(),
    minConfidence: Probability.optional(),
  })
  .strict();

export const FittedFileSchema = z.object({
  pin: z.string().min(1),
  generatedAt: z.string().min(1),
  rulebookVersion: z.string().optional(),
  rules: z.record(z.string(), FittedThresholdsSchema),
});

export type FittedThresholds = z.infer<typeof FittedThresholdsSchema>;
export type FittedFile = z.infer<typeof FittedFileSchema>;

export const DEFAULT_ADVISE = 0.55;
export const DEFAULT_UNCERTAIN = { lo: 0.35, hi: 0.65 };
export const DEFAULT_MIN_CONFIDENCE = 0.6;

export interface ResolvedThresholds {
  deny?: number;
  ask?: number;
  advise: number;
  uncertain: { lo: number; hi: number };
  minConfidence: number;
}

export interface Outcome {
  decision: Decision;
  value: number;
  confidence?: number;
  answer: number | string;
  calibrated: boolean;
  thresholds: ResolvedThresholds;
}

export interface DecideContext {
  uncalibrated?: boolean;
}

export class FittedFileError extends Error {}

export type FittedLoad = { status: 'none' } | { status: 'ok'; fitted: FittedFile } | { status: 'mismatch'; fitted: FittedFile; reason: string };

export type ParseFittedResult = { ok: true; fitted: FittedFile } | { ok: false; error: string };

export function parseFitted(input: unknown): ParseFittedResult {
  const result = FittedFileSchema.safeParse(input);
  return result.success ? { ok: true, fitted: result.data } : { ok: false, error: formatIssues(result.error) };
}

export function loadFitted(fittedDir: string, pin: string, rulebookVersion?: string): FittedLoad {
  const path = join(fittedDir, `${pin}.json`);
  if (!existsSync(path)) {
    return { status: 'none' };
  }
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new FittedFileError(`invalid fitted thresholds at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = parseFitted(json);
  if (!parsed.ok) {
    throw new FittedFileError(`invalid fitted thresholds at ${path}:\n${parsed.error}`);
  }
  const reasons: string[] = [];
  if (parsed.fitted.pin !== pin) {
    reasons.push(`file pin ${parsed.fitted.pin} != ${pin}`);
  }
  if (rulebookVersion !== undefined && parsed.fitted.rulebookVersion !== undefined && parsed.fitted.rulebookVersion !== rulebookVersion) {
    reasons.push(`file rulebook ${parsed.fitted.rulebookVersion} != ${rulebookVersion}`);
  }
  if (reasons.length > 0) {
    return { status: 'mismatch', fitted: parsed.fitted, reason: reasons.join('; ') };
  }
  return { status: 'ok', fitted: parsed.fitted };
}

export function resolveThresholds(rule: Rule, fitted: FittedThresholds | undefined): ResolvedThresholds {
  const book = rule.thresholds;
  const bookUncertain = book && 'uncertain' in book ? book.uncertain : undefined;
  const bookMinConfidence = book && 'minConfidence' in book ? book.minConfidence : undefined;
  const resolved: ResolvedThresholds = {
    advise: fitted?.advise ?? book?.advise ?? DEFAULT_ADVISE,
    uncertain: fitted?.uncertain ?? bookUncertain ?? DEFAULT_UNCERTAIN,
    minConfidence: fitted?.minConfidence ?? bookMinConfidence ?? DEFAULT_MIN_CONFIDENCE,
  };
  const ask = fitted?.ask ?? book?.ask;
  if (ask !== undefined) {
    resolved.ask = ask;
  }
  if (fitted?.deny !== undefined) {
    resolved.deny = fitted.deny;
  }
  return resolved;
}

function decideByThresholds(value: number, thresholds: ResolvedThresholds): Decision {
  if (thresholds.deny !== undefined && value >= thresholds.deny) {
    return 'deny';
  }
  if (thresholds.ask !== undefined && value >= thresholds.ask) {
    return 'ask';
  }
  if (value >= thresholds.advise) {
    return 'advise';
  }
  return 'pass';
}

function violatingMass(rule: Rule, answer: Extract<JevAnswer, { type: 'choice' | 'score' }>): number {
  const question = rule.question;
  if (!question || question.type === 'noul') {
    throw new TypeError(`rule ${rule.id}: expected a ${question?.type ?? 'noul'} answer, received ${answer.type}`);
  }
  if (question.type === 'choice') {
    if (answer.type !== 'choice') {
      throw new TypeError(`rule ${rule.id}: expected a choice answer, received ${answer.type}`);
    }
    return question.violatingOptions.reduce((sum, option) => sum + (answer.probabilities[option] ?? 0), 0);
  }
  if (answer.type !== 'score') {
    throw new TypeError(`rule ${rule.id}: expected a score answer, received ${answer.type}`);
  }
  const indexes = question.levels.map((level, index) => (question.violatingLevels.includes(level.id) ? String(index) : null));
  return indexes.reduce((sum, key) => (key === null ? sum : sum + (answer.probabilities[key] ?? 0)), 0);
}

export function decide(rule: Rule, answer: JevAnswer, fitted?: FittedThresholds, context: DecideContext = {}): Outcome {
  const thresholds = resolveThresholds(rule, fitted);
  const calibrated = fitted !== undefined;
  const question = rule.question;
  if (!question) {
    throw new TypeError(`rule ${rule.id} has no question`);
  }

  if (question.type === 'noul') {
    if (answer.type !== 'noul') {
      throw new TypeError(`rule ${rule.id}: expected a noul answer, received ${answer.type}`);
    }
    const value = answer.noul;
    const base: Omit<Outcome, 'decision'> = { value, answer: value, calibrated, thresholds };
    if (context.uncalibrated) {
      return { ...base, decision: 'uncalibrated' };
    }
    if (value >= thresholds.uncertain.lo && value <= thresholds.uncertain.hi) {
      return { ...base, decision: 'uncertain' };
    }
    return { ...base, decision: decideByThresholds(value, thresholds) };
  }

  if (answer.type === 'noul') {
    throw new TypeError(`rule ${rule.id}: expected a ${question.type} answer, received noul`);
  }
  const value = violatingMass(rule, answer);
  const base: Omit<Outcome, 'decision'> = {
    value,
    confidence: answer.confidence,
    answer: answer.type === 'choice' ? answer.choice : answer.score,
    calibrated,
    thresholds,
  };
  if (context.uncalibrated) {
    return { ...base, decision: 'uncalibrated' };
  }
  if (answer.confidence < thresholds.minConfidence) {
    return { ...base, decision: 'uncertain' };
  }
  return { ...base, decision: decideByThresholds(value, thresholds) };
}
