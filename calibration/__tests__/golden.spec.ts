import '../../scripts/__tests__/helpers/no-network.ts';
import { describe, expect, it } from 'bun:test';
import { join, resolve } from 'node:path';
import { readRulebookFile } from '../../scripts/lib/compose.ts';
import { isInScope } from '../../scripts/lib/scope.ts';
import { loadGoldenCases } from '../lib/golden.ts';

const PLUGIN_ROOT = resolve(import.meta.dir, '../..');
const GOLDEN_ROOT = join(PLUGIN_ROOT, 'calibration', 'golden');
const { rulebook } = readRulebookFile(join(PLUGIN_ROOT, 'rulebooks', 'hexagonal.rulebook.yaml'));
const semanticRules = rulebook.rules.filter((rule) => rule.class === 'semantic');

const MIN_GOOD = 8;
const MIN_BAD = 8;
const MIN_ADVERSARIAL = 5;
const STEERING_COMMENT = /\/\/.*(not business logic|reviewer|does not apply|safe: orchestration|trivial wrapper|redundant|TODO|ignore|picks|decides|computes)/i;

describe('semantic golden sets', () => {
  it('declare five semantic rules', () => {
    expect(semanticRules.map((rule) => rule.id).sort()).toEqual([
      'hex/controller-thin',
      'hex/entity-not-anemic',
      'hex/handler-no-business-rules',
      'hex/no-overengineering',
      'hex/port-no-infra-leak',
    ]);
  });

  for (const rule of semanticRules) {
    describe(rule.id, () => {
      const cases = loadGoldenCases(GOLDEN_ROOT, rule.id, PLUGIN_ROOT);
      const good = cases.filter((entry) => entry.label === 'good');
      const bad = cases.filter((entry) => entry.label === 'bad');
      const adversarial = good.filter((entry) => entry.caseId.startsWith('adversarial-'));

      it(`has at least ${MIN_GOOD} plain good, ${MIN_BAD} bad and ${MIN_ADVERSARIAL} adversarial good cases`, () => {
        expect(good.length - adversarial.length).toBeGreaterThanOrEqual(MIN_GOOD);
        expect(bad.length).toBeGreaterThanOrEqual(MIN_BAD);
        expect(adversarial.length).toBeGreaterThanOrEqual(MIN_ADVERSARIAL);
      });

      it('keeps every fixture inside the rule scope with a labelled case.json', () => {
        for (const entry of cases) {
          expect(isInScope(rule.scope, entry.file.path), entry.file.path).toBe(true);
          expect(entry.expected).toBe(entry.label === 'bad' ? 'violation' : 'ok');
          expect(entry.note.length).toBeGreaterThan(10);
        }
      });

      it('adversarial good cases carry a steering comment', () => {
        for (const entry of adversarial) {
          expect(STEERING_COMMENT.test(entry.file.content), entry.caseId).toBe(true);
        }
      });

      it('has unique case ids and non-trivial files', () => {
        expect(new Set(cases.map((entry) => `${entry.label}/${entry.caseId}`)).size).toBe(cases.length);
        for (const entry of cases) {
          expect(entry.file.content.split('\n').length, entry.caseId).toBeGreaterThanOrEqual(5);
          expect(entry.file.content, entry.caseId).not.toMatch(/\bas\s+(?:unknown|any)\b/);
        }
      });
    });
  }
});
