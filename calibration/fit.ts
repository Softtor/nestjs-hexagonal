import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadComposedRulebook } from '../scripts/lib/compose.ts';
import type { FittedFile } from '../scripts/lib/decide.ts';
import type { Rule } from '../scripts/lib/rulebook.schema.ts';
import { DENY_MIN_PRECISION, DENY_MIN_SAMPLES, REPORT_CUTS, fitRule, type FitInput, type FitResult } from './lib/metrics.ts';
import { readAllResults, type ResultRecord } from './lib/results.ts';

export interface FitAllInput {
  pin: string;
  rulebookVersion: string;
  rules: Rule[];
  resultsByRule: Map<string, ResultRecord[]>;
  generatedAt?: string;
}

export interface FitAllOutput {
  fittedFile: FittedFile;
  report: string;
  fits: FitResult[];
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function interval(lo: number, hi: number): string {
  return `[${pct(lo)}, ${pct(hi)}]`;
}

function fitInputFor(rule: Rule | undefined, ruleId: string, records: ResultRecord[]): FitInput {
  const input: FitInput = { ruleId, records };
  const thresholds = rule?.thresholds;
  if (thresholds && 'uncertain' in thresholds) {
    input.uncertain = thresholds.uncertain;
  }
  if (thresholds && 'minConfidence' in thresholds) {
    input.minConfidence = thresholds.minConfidence;
  }
  return input;
}

export function fitAll(input: FitAllInput): FitAllOutput {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const ruleById = new Map(input.rules.map((rule) => [rule.id, rule]));
  const fits: FitResult[] = [];
  for (const [ruleId, records] of [...input.resultsByRule.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    fits.push(fitRule(fitInputFor(ruleById.get(ruleId), ruleId, records)));
  }
  const fittedFile: FittedFile = { pin: input.pin, generatedAt, rulebookVersion: input.rulebookVersion, rules: {} };
  for (const fit of fits) {
    if (fit.fitted.advise !== undefined) {
      fittedFile.rules[fit.metrics.ruleId] = fit.fitted;
    }
  }
  return { fittedFile, report: renderReport(input.pin, input.rulebookVersion, generatedAt, fits), fits };
}

export function renderReport(pin: string, rulebookVersion: string, generatedAt: string, fits: FitResult[]): string {
  const lines: string[] = [];
  lines.push(`# Calibration report for ${pin}`);
  lines.push('');
  lines.push(`Generated ${generatedAt} against rulebook \`hexagonal\` ${rulebookVersion}. Cuts are applied to the noul probability or to the probability mass on the violating options/levels. Intervals are 95% Wilson. \`deny\` is fitted only with at least ${DENY_MIN_SAMPLES} good and ${DENY_MIN_SAMPLES} bad cases, precision >= ${DENY_MIN_PRECISION} and zero false positives on the good cases.`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Rule | Primitive | Good | Bad | Errors | Advise | Ask | Deny | Uncertain rate | p50 ms | p95 ms | Models | Also caught by static? (does not count) |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const fit of fits) {
    const m = fit.metrics;
    const deny = fit.fitted.deny === undefined ? `omitted` : String(fit.fitted.deny);
    lines.push(
      `| \`${m.ruleId}\` | ${m.primitive} | ${m.nGood} | ${m.nBad} | ${m.errors} | ${fit.fitted.advise ?? '-'} | ${fit.fitted.ask ?? '-'} | ${deny} | ${pct(m.uncertainRate)} | ${m.latency.p50} | ${m.latency.p95} | ${m.models.join(', ') || '-'} | TODO=false |`,
    );
  }
  for (const fit of fits) {
    const m = fit.metrics;
    lines.push('');
    lines.push(`## ${m.ruleId}`);
    lines.push('');
    lines.push(`Primitive ${m.primitive}, ${m.nGood} good and ${m.nBad} bad cases, ${m.errors} error(s), ${m.inputTokens} input tokens, uncertain rate ${pct(m.uncertainRate)}.`);
    if (fit.denyReason !== null) {
      lines.push('');
      lines.push(`\`deny\` omitted: ${fit.denyReason}.`);
    }
    lines.push('');
    lines.push('| Cut | TP | FP | FN | TN | Precision | Recall | F1 |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const cut of m.cuts.filter((entry) => REPORT_CUTS.some((reported) => reported === entry.cut))) {
      lines.push(
        `| ${cut.cut} | ${cut.tp} | ${cut.fp} | ${cut.fn} | ${cut.tn} | ${pct(cut.precision)} ${interval(cut.precisionInterval.lo, cut.precisionInterval.hi)} | ${pct(cut.recall)} ${interval(cut.recallInterval.lo, cut.recallInterval.hi)} | ${cut.f1.toFixed(3)} |`,
      );
    }
    const adviseCut = m.cuts.find((entry) => entry.cut === fit.fitted.advise);
    if (adviseCut) {
      lines.push('');
      lines.push(`At the fitted advise cut ${adviseCut.cut}: ${adviseCut.fn} miss(es) ${adviseCut.misses.length > 0 ? `(${adviseCut.misses.join(', ')})` : ''}; ${adviseCut.fp} false positive(s) ${adviseCut.falsePositives.length > 0 ? `(${adviseCut.falsePositives.join(', ')})` : ''}.`);
    }
    lines.push('');
    lines.push('Also caught by static? does not count: TODO=false (no static overlap has been measured yet).');
  }
  return `${lines.join('\n')}\n`;
}

interface FitCliArgs {
  pin: string;
  resultsDir?: string;
  fittedPath?: string;
  reportPath?: string;
}

function parseFitArgs(argv: string[]): FitCliArgs {
  const args: FitCliArgs = { pin: 'jev-1.13.0' };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) {
      throw new Error(`${flag} requires a value`);
    }
    switch (flag) {
      case '--pin':
        args.pin = value;
        break;
      case '--results':
        args.resultsDir = value;
        break;
      case '--fitted':
        args.fittedPath = value;
        break;
      case '--report':
        args.reportPath = value;
        break;
      default:
        throw new Error(`unknown option '${flag}'`);
    }
    i += 1;
  }
  return args;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(isAbsolute(entry) ? entry : resolve(entry)).href;
}

if (isMainModule()) {
  const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const args = parseFitArgs(process.argv.slice(2));
  const resultsDir = resolve(args.resultsDir ?? join(pluginRoot, 'calibration', 'results', args.pin));
  const fittedPath = resolve(args.fittedPath ?? join(pluginRoot, 'calibration', 'fitted', `${args.pin}.json`));
  const reportPath = resolve(args.reportPath ?? join(pluginRoot, 'calibration', 'report.md'));
  const composed = loadComposedRulebook(join(pluginRoot, 'rulebooks', 'hexagonal.rulebook.yaml'), join(pluginRoot, 'rulebooks'));
  const resultsByRule = readAllResults(resultsDir);
  if (resultsByRule.size === 0) {
    process.stderr.write(`no results under ${resultsDir}; run calibration/run.ts first\n`);
    process.exitCode = 2;
  } else {
    const output = fitAll({ pin: args.pin, rulebookVersion: composed.rulebook.version, rules: composed.rules, resultsByRule });
    mkdirSync(dirname(fittedPath), { recursive: true });
    writeFileSync(fittedPath, `${JSON.stringify(output.fittedFile, null, 2)}\n`);
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, output.report);
    process.stdout.write(`fitted ${Object.keys(output.fittedFile.rules).length} rule(s) into ${fittedPath}; report at ${reportPath}\n`);
    for (const fit of output.fits) {
      process.stdout.write(`${fit.metrics.ruleId}: advise=${fit.fitted.advise ?? '-'} ask=${fit.fitted.ask ?? '-'} deny=${fit.fitted.deny ?? `omitted (${fit.denyReason ?? 'n/a'})`}\n`);
    }
  }
}
