import './helpers/no-network.ts';
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide, loadFitted, parseFitted, type FittedThresholds } from '../lib/decide.ts';
import { RuleSchema, type Rule } from '../lib/rulebook.schema.ts';
import type { JevAnswer } from '../lib/jev-client.ts';

function noulRule(thresholds?: Record<string, unknown>): Rule {
  return RuleSchema.parse({
    id: 'hex/noul-rule',
    title: 't',
    layer: 'application',
    scope: { include: ['**'] },
    class: 'semantic',
    severity: 'FAIL',
    rationale: 'r',
    fix: 'f',
    question: { type: 'noul', instructions: 'Is it?' },
    state: {},
    ...(thresholds ? { thresholds } : {}),
  });
}

function choiceRule(thresholds?: Record<string, unknown>): Rule {
  return RuleSchema.parse({
    id: 'hex/choice-rule',
    title: 't',
    layer: 'application',
    scope: { include: ['**'] },
    class: 'semantic',
    severity: 'WARN',
    rationale: 'r',
    fix: 'f',
    question: {
      type: 'choice',
      instructions: 'Which?',
      options: [
        { id: 'bad-a', criteria: 'a' },
        { id: 'bad-b', criteria: 'b' },
        { id: 'none', criteria: 'n' },
        { id: 'other', criteria: 'o' },
      ],
      violatingOptions: ['bad-a', 'bad-b'],
    },
    state: {},
    ...(thresholds ? { thresholds } : {}),
  });
}

function scoreRule(): Rule {
  return RuleSchema.parse({
    id: 'hex/score-rule',
    title: 't',
    layer: 'application',
    scope: { include: ['**'] },
    class: 'semantic',
    severity: 'WARN',
    rationale: 'r',
    fix: 'f',
    question: {
      type: 'score',
      instructions: 'How bad?',
      levels: [
        { id: 'clean', criteria: 'c' },
        { id: 'smelly', criteria: 's' },
        { id: 'broken', criteria: 'b' },
      ],
      violatingLevels: ['broken'],
    },
    state: {},
  });
}

const noul = (p: number): JevAnswer => ({ type: 'noul', noul: p });
const choice = (probabilities: Record<string, number>, confidence: number): JevAnswer => {
  const [best] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0] ?? ['other', 0];
  return { type: 'choice', choice: best, confidence, probabilities };
};

describe('decide for noul rules', () => {
  const fitted: FittedThresholds = { deny: 0.9, ask: 0.75, advise: 0.55, uncertain: { lo: 0.35, hi: 0.65 } };

  it('p=0.5 is uncertain', () => {
    expect(decide(noulRule(), noul(0.5)).decision).toBe('uncertain');
  });

  it('p=0.97 with a fitted deny threshold is deny and calibrated', () => {
    const outcome = decide(noulRule(), noul(0.97), fitted);
    expect(outcome.decision).toBe('deny');
    expect(outcome.calibrated).toBe(true);
    expect(outcome.value).toBe(0.97);
  });

  it('p=0.97 without fitted thresholds is at most ask and not calibrated, even when the rulebook declares deny', () => {
    const rule = noulRule({ deny: 0.9, ask: 0.75, advise: 0.55, uncertain: { lo: 0.35, hi: 0.65 } });
    const outcome = decide(rule, noul(0.97));
    expect(outcome.decision).toBe('ask');
    expect(outcome.calibrated).toBe(false);
  });

  it('p=0.97 with only rulebook advise is advise', () => {
    expect(decide(noulRule({ advise: 0.55, uncertain: { lo: 0.35, hi: 0.65 } }), noul(0.97)).decision).toBe('advise');
  });

  it('p=0.05 is pass', () => {
    expect(decide(noulRule(), noul(0.05), fitted).decision).toBe('pass');
  });

  it('p=0.8 with fitted ask is ask, p=0.6 with fitted advise and band [0.35,0.55] is advise', () => {
    expect(decide(noulRule(), noul(0.8), fitted).decision).toBe('ask');
    expect(decide(noulRule(), noul(0.6), { ...fitted, uncertain: { lo: 0.35, hi: 0.55 } }).decision).toBe('advise');
  });

  it('fitted thresholds take precedence over rulebook thresholds over defaults', () => {
    const rule = noulRule({ advise: 0.7, uncertain: { lo: 0.1, hi: 0.2 } });
    expect(decide(rule, noul(0.6)).decision).toBe('pass');
    expect(decide(rule, noul(0.6), { advise: 0.5 }).decision).toBe('advise');
    expect(decide(rule, noul(0.15), { advise: 0.5 }).decision).toBe('uncertain');
  });

  it('is uncalibrated and never deny when the client or the composition is uncalibrated', () => {
    expect(decide(noulRule(), noul(0.99), fitted, { uncalibrated: true }).decision).toBe('uncalibrated');
    expect(decide(noulRule(), noul(0.01), fitted, { uncalibrated: true }).decision).toBe('uncalibrated');
  });

  it('rejects an answer of another primitive', () => {
    expect(() => decide(noulRule(), choice({ none: 1 }, 1))).toThrow(/expected a noul answer/);
  });
});

describe('decide for choice and score rules', () => {
  it('confidence below minConfidence is uncertain', () => {
    const outcome = decide(choiceRule(), choice({ 'bad-a': 0.5, none: 0.5 }, 0.4));
    expect(outcome.decision).toBe('uncertain');
    expect(outcome.confidence).toBe(0.4);
  });

  it('sums the mass on violating options and compares it with the thresholds', () => {
    const answer = choice({ 'bad-a': 0.4, 'bad-b': 0.3, none: 0.2, other: 0.1 }, 0.7);
    const outcome = decide(choiceRule(), answer);
    expect(outcome.value).toBeCloseTo(0.7);
    expect(outcome.decision).toBe('advise');
    expect(outcome.calibrated).toBe(false);
    expect(decide(choiceRule(), answer, { deny: 0.65, ask: 0.6, advise: 0.5, minConfidence: 0.6 }).decision).toBe('deny');
  });

  it('a confident none is pass', () => {
    expect(decide(choiceRule(), choice({ none: 0.95, other: 0.05 }, 0.95)).decision).toBe('pass');
  });

  it('a choice rule never denies without fitted thresholds even with deny in the rulebook', () => {
    const rule = choiceRule({ deny: 0.6, ask: 0.55, advise: 0.5, minConfidence: 0.5 });
    expect(decide(rule, choice({ 'bad-a': 0.9, none: 0.1 }, 0.9)).decision).toBe('ask');
  });

  it('score uses the probability mass on violating levels by index', () => {
    const answer: JevAnswer = {
      type: 'score',
      score: 1.8,
      confidence: 0.85,
      legend: { '0': 'c', '1': 's', '2': 'b' },
      probabilities: { '0': 0.05, '1': 0.15, '2': 0.8 },
    };
    const outcome = decide(scoreRule(), answer, { deny: 0.9, ask: 0.75, advise: 0.55, minConfidence: 0.6 });
    expect(outcome.value).toBeCloseTo(0.8);
    expect(outcome.decision).toBe('ask');
  });
});

describe('fitted files', () => {
  it('parses a fitted file keyed by rule id and rejects malformed input', () => {
    const parsed = parseFitted({ pin: 'jev-1.13.0', generatedAt: '2026-09-20T00:00:00Z', rules: { 'hex/noul-rule': { advise: 0.6, uncertain: { lo: 0.3, hi: 0.7 } } } });
    expect(parsed.ok && parsed.fitted.rules['hex/noul-rule']?.advise).toBe(0.6);
    expect(parseFitted({ pin: 'x', rules: { 'hex/a': { deny: 2 } } }).ok).toBe(false);
  });

  it('loads a fitted file for a pin and returns null when it is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fitted-'));
    writeFileSync(join(dir, 'jev-1.13.0.json'), JSON.stringify({ pin: 'jev-1.13.0', generatedAt: 'now', rules: {} }));
    expect(loadFitted(dir, 'jev-1.13.0')?.pin).toBe('jev-1.13.0');
    expect(loadFitted(dir, 'jev-9.0.0')).toBeNull();
  });
});
