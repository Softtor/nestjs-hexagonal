import '../../scripts/__tests__/helpers/no-network.ts';
import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readRulebookFile } from '../../scripts/lib/compose.ts';
import { loadFitted } from '../../scripts/lib/decide.ts';
import { DENY_MIN_PRECISION, metricsAtCut } from '../lib/metrics.ts';
import { readAllResults, type ResultRecord } from '../lib/results.ts';

const PLUGIN_ROOT = resolve(import.meta.dir, '../..');
const { rulebook } = readRulebookFile(join(PLUGIN_ROOT, 'rulebooks', 'hexagonal.rulebook.yaml'));
const PIN = rulebook.model.pin;
const RESULTS_DIR = join(PLUGIN_ROOT, 'calibration', 'results', PIN);
const FITTED_DIR = join(PLUGIN_ROOT, 'calibration', 'fitted');

const hasResults = existsSync(RESULTS_DIR);

describe.skipIf(!hasResults)(`fitted regression for ${PIN}`, () => {
  const resultsByRule = hasResults ? readAllResults(RESULTS_DIR) : new Map<string, ResultRecord[]>();
  const loaded = hasResults ? loadFitted(FITTED_DIR, PIN, rulebook.version) : { status: 'none' as const };
  const fitted = loaded.status === 'none' ? null : loaded.fitted;

  it('has results for at least one rule', () => {
    expect(resultsByRule.size).toBeGreaterThan(0);
  });

  it('records only the pinned model', () => {
    for (const [ruleId, records] of resultsByRule) {
      const models = [...new Set(records.filter((record) => record.error === undefined).map((record) => record.model))];
      expect(models, ruleId).toEqual([PIN]);
    }
  });

  it('keeps precision >= 0.95 at the fitted deny cut of every rule that denies', () => {
    if (fitted === null) {
      return;
    }
    expect(loaded.status).toBe('ok');
    expect(fitted.pin).toBe(PIN);
    for (const [ruleId, thresholds] of Object.entries(fitted.rules)) {
      if (thresholds.deny === undefined) {
        continue;
      }
      const records = (resultsByRule.get(ruleId) ?? []).filter((record) => record.error === undefined);
      expect(records.length, `${ruleId} has results`).toBeGreaterThan(0);
      const metrics = metricsAtCut(records, thresholds.deny);
      expect(metrics.precision, `${ruleId} precision at deny ${thresholds.deny}`).toBeGreaterThanOrEqual(DENY_MIN_PRECISION);
      expect(metrics.fp, `${ruleId} false positives at deny`).toBe(0);
    }
  });
});
