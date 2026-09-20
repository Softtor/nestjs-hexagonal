import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RulebookCompositionError, semanticRulebookVersion, type ComposedRulebook } from './lib/compose.ts';
import { FittedFileError, loadFitted, type FittedFile } from './lib/decide.ts';
import { readHookLogs, summarizeHookLogs } from './lib/hook-log.ts';
import { createJevClient, type FetchLike } from './lib/jev-client.ts';
import { changedFilesSince, projectSources, readSources } from './lib/project-files.ts';
import { RulebookNotFoundError, loadProjectRulebook } from './lib/project-rulebook.ts';
import { matchGlob, normalizePath } from './lib/scope.ts';
import { resolveDataDir } from './lib/session-store.ts';
import { explainRequests, planSemanticRequests, runSemanticRules, type SemanticExplain, type SemanticFinding, type Undecided } from './lib/semantic-engine.ts';
import type { Hunk } from './lib/state-builder.ts';
import { runStaticRules, type Finding, type SourceFile } from './lib/static-engine.ts';
import type { RuleClass } from './lib/rulebook.schema.ts';

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export interface CliOptions {
  cwd: string;
  env: Record<string, string | undefined>;
  pluginRoot: string;
  fetchImpl?: FetchLike;
  fittedDir?: string;
}

interface ParsedArgs {
  rulebook?: string;
  projectRulebook?: string;
  files: string[];
  diff?: string;
  classes: RuleClass[];
  format: 'json' | 'text';
  strict: boolean;
  failOnUncertain: boolean;
  explain: boolean;
  help: boolean;
}

class UsageError extends Error {}

const USAGE = `Usage: nestjs-hexagonal-check [options]
       nestjs-hexagonal-check export-logs --since <date> [--out <file>]

  --rulebook <path|id>        rulebook to run; an id resolves to <plugin>/rulebooks/<id>.rulebook.yaml
  --project-rulebook <path>   project rulebook (default: $NESTJS_HEXAGONAL_RULEBOOK or $CLAUDE_PROJECT_DIR/.claude/rulebook.yaml)
  --files <glob...>           files to check, as globs relative to the current directory
  --diff <base>               check the files changed since <base> (git diff --name-only <base>)
  --classes <list>            comma-separated rule classes to run (default: static); semantic needs TYPESAFE_API_KEY
  --format json|text          output format (default: text)
  --strict                    exit 1 when a static FAIL or a semantic deny exists
  --fail-on-uncertain         with --strict, exit 3 when a semantic answer is uncertain or uncalibrated
  --explain                   list the rules applied to each file
  --help                      show this message
`;

const IGNORED_DIRECTORIES = new Set(['node_modules', '.git']);
const RULE_CLASSES: RuleClass[] = ['static', 'semantic', 'runtime'];

function isRuleClass(value: string): value is RuleClass {
  return RULE_CLASSES.some((entry) => entry === value);
}

export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { files: [], classes: ['static'], format: 'text', strict: false, failOnUncertain: false, explain: false, help: false };
  let i = 0;
  const takeValue = (flag: string): string => {
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new UsageError(`${flag} requires a value`);
    }
    i += 1;
    return value;
  };

  while (i < argv.length) {
    const arg = argv[i];
    switch (arg) {
      case '--rulebook':
        parsed.rulebook = takeValue(arg);
        break;
      case '--project-rulebook':
        parsed.projectRulebook = takeValue(arg);
        break;
      case '--files':
        while (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) {
          parsed.files.push(argv[i + 1]);
          i += 1;
        }
        if (parsed.files.length === 0) {
          throw new UsageError('--files requires at least one glob');
        }
        break;
      case '--diff':
        parsed.diff = takeValue(arg);
        break;
      case '--classes': {
        const classes = takeValue(arg).split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0);
        for (const entry of classes) {
          if (!isRuleClass(entry)) {
            throw new UsageError(`unknown rule class '${entry}'`);
          }
        }
        parsed.classes = classes.filter(isRuleClass);
        break;
      }
      case '--format': {
        const format = takeValue(arg);
        if (format !== 'json' && format !== 'text') {
          throw new UsageError(`unknown format '${format}'`);
        }
        parsed.format = format;
        break;
      }
      case '--strict':
        parsed.strict = true;
        break;
      case '--fail-on-uncertain':
        parsed.failOnUncertain = true;
        break;
      case '--explain':
        parsed.explain = true;
        break;
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      default:
        throw new UsageError(`unknown option '${arg}'`);
    }
    i += 1;
  }
  return parsed;
}

function walk(dir: string, base: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, base, out);
    } else if (entry.isFile()) {
      out.push(normalizePath(relative(base, full)));
    }
  }
}

function expandGlobs(globs: string[], cwd: string): string[] {
  const literal = globs.filter((pattern) => !/[*?{]/.test(pattern));
  const patterns = globs.filter((pattern) => /[*?{]/.test(pattern));
  const selected = new Set<string>();

  for (const path of literal) {
    const full = resolve(cwd, path);
    if (!existsSync(full)) {
      continue;
    }
    if (statSync(full).isDirectory()) {
      const inside: string[] = [];
      walk(full, cwd, inside);
      for (const entry of inside) {
        selected.add(entry);
      }
    } else if (statSync(full).isFile()) {
      selected.add(normalizePath(relative(cwd, full)));
    }
  }

  if (patterns.length > 0) {
    const all: string[] = [];
    walk(cwd, cwd, all);
    for (const path of all) {
      if (patterns.some((pattern) => matchGlob(pattern, path))) {
        selected.add(path);
      }
    }
  }

  return [...selected].sort();
}

function changedFiles(base: string, cwd: string): string[] {
  const files = changedFilesSince(base, cwd);
  if (files === null) {
    throw new UsageError(`--diff ${base}: git is unavailable or ${cwd} is not inside a repository`);
  }
  return files;
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedDiff(diff: string): Record<string, Hunk[]> {
  const hunks: Record<string, Hunk[]> = {};
  let current: string | null = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).trim();
      current = target === '/dev/null' ? null : normalizePath(target);
      continue;
    }
    const header = HUNK_HEADER.exec(line);
    if (header && current !== null) {
      const start = Number(header[1]);
      const count = header[2] === undefined ? 1 : Number(header[2]);
      if (count > 0) {
        (hunks[current] ??= []).push({ start, end: start + count - 1 });
      }
    }
  }
  return hunks;
}

function changedHunks(base: string, cwd: string): Record<string, Hunk[]> {
  const diff = execFileSync('git', ['diff', '--unified=0', '--no-prefix', '--relative', '--diff-filter=ACMR', base], { cwd, encoding: 'utf8' });
  return parseUnifiedDiff(diff);
}

type AnyFinding = Finding | SemanticFinding;

interface SemanticSummary {
  requests: number;
  cached: number;
  inputTokens: number;
  undecided: Undecided[];
  skippedReason?: string;
}

interface Report {
  rulebook: { id: string; version: string; path: string; pin: string };
  uncalibrated: boolean;
  warnings: string[];
  files: number;
  findings: AnyFinding[];
  skipped: { semantic: string[]; runtime: string[] };
  semantic?: SemanticSummary;
  explain?: Record<string, string[]>;
  explainSemantic?: SemanticExplain[];
}

const DECISION_ORDER: Array<SemanticFinding['decision']> = ['deny', 'ask', 'advise', 'uncertain', 'uncalibrated'];

function isSemantic(finding: AnyFinding): finding is SemanticFinding {
  return finding.class === 'semantic';
}

function location(finding: AnyFinding): string {
  return finding.line === undefined ? finding.path : `${finding.path}:${finding.line}`;
}

function formatText(report: Report): string {
  const lines: string[] = [];
  const statics = report.findings.filter((finding) => !isSemantic(finding));
  const semantics = report.findings.filter(isSemantic);
  for (const finding of statics) {
    lines.push(`${location(finding)} ${finding.severity} ${finding.ruleId}: ${finding.evidence}`);
    lines.push(`  fix: ${finding.fix}`);
  }
  for (const decision of DECISION_ORDER) {
    const group = semantics.filter((finding) => finding.decision === decision);
    if (group.length === 0) {
      continue;
    }
    lines.push('');
    lines.push(`semantic ${decision} (${group.length}):`);
    for (const finding of group) {
      const calibration = finding.calibrated ? '' : ' [not calibrated]';
      lines.push(`${location(finding)} ${finding.severity} ${finding.ruleId}: ${finding.evidence}${calibration}`);
      lines.push(`  fix: ${finding.fix}`);
    }
  }
  if (report.semantic && report.semantic.undecided.length > 0) {
    lines.push('');
    lines.push(`semantic undecided (${report.semantic.undecided.length}):`);
    for (const entry of report.semantic.undecided) {
      lines.push(`${entry.path} ${entry.ruleIds.join(', ')}: ${entry.reason}`);
    }
  }
  if (report.explain) {
    lines.push('');
    for (const [path, ruleIds] of Object.entries(report.explain)) {
      lines.push(`${path}: ${ruleIds.join(', ')}`);
    }
  }
  if (report.explainSemantic) {
    for (const entry of report.explainSemantic) {
      lines.push('');
      lines.push(`${entry.path} [slice ${entry.slice}]`);
      for (const [ruleId, question] of Object.entries(entry.questions)) {
        lines.push(`  ${ruleId} (${question.type}): ${question.instructions}`);
      }
      lines.push('  state.code:');
      for (const line of entry.code.split('\n')) {
        lines.push(`    ${line}`);
      }
    }
  }
  const fails = statics.filter((finding) => finding.severity === 'FAIL').length;
  const warns = statics.length - fails;
  const calibration = report.uncalibrated ? ', uncalibrated' : '';
  lines.push('');
  lines.push(`${fails} FAIL, ${warns} WARN in ${report.files} file(s) (rulebook ${report.rulebook.id} ${report.rulebook.version}${calibration})`);
  if (report.semantic) {
    const counts = DECISION_ORDER.map((decision) => `${semantics.filter((finding) => finding.decision === decision).length} ${decision}`).join(', ');
    const cached = report.semantic.cached > 0 ? `, ${report.semantic.cached} cached` : '';
    lines.push(`semantic: ${counts} (${report.semantic.requests} request(s)${cached}, ${report.semantic.inputTokens} input tokens, model ${report.rulebook.pin})`);
  }
  return `${lines.join('\n')}\n`;
}

function sortFindings(findings: AnyFinding[]): AnyFinding[] {
  return findings.sort((a, b) => a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0) || a.ruleId.localeCompare(b.ruleId));
}

function pluginDataPaths(env: Record<string, string | undefined>): { cacheDir?: string; logPath?: string; breakerPath?: string } {
  const dataDir = env.CLAUDE_PLUGIN_DATA;
  if (dataDir === undefined || dataDir === '') {
    return {};
  }
  return { cacheDir: join(dataDir, 'cache'), logPath: join(dataDir, 'jev.jsonl'), breakerPath: join(dataDir, 'breaker.json') };
}

async function runSemantic(
  composed: ComposedRulebook,
  files: SourceFile[],
  hunksByPath: Record<string, Hunk[]>,
  io: CliIo,
  options: CliOptions,
): Promise<{ findings: SemanticFinding[]; warnings: string[]; summary: SemanticSummary; applied: Record<string, string[]> }> {
  const rules = composed.rules.filter((rule) => rule.class === 'semantic');
  const pin = composed.rulebook.model.pin;
  const empty = { findings: [], warnings: [], applied: {} };
  if (rules.length === 0) {
    return { ...empty, summary: { requests: 0, cached: 0, inputTokens: 0, undecided: [] } };
  }
  const apiKey = options.env.TYPESAFE_API_KEY ?? options.env.CLAUDE_PLUGIN_OPTION_TYPESAFE_API_KEY;
  if (apiKey === undefined || apiKey === '') {
    const reason = `TYPESAFE_API_KEY is not set; skipped ${rules.length} semantic rule(s)`;
    io.stderr(`${reason}\n`);
    return { ...empty, summary: { requests: 0, cached: 0, inputTokens: 0, undecided: [], skippedReason: reason } };
  }
  const loaded = loadFitted(options.fittedDir ?? join(options.pluginRoot, 'calibration', 'fitted'), pin, semanticRulebookVersion(composed));
  const fitted: FittedFile | null = loaded.status === 'none' ? null : loaded.fitted;
  const fittedMismatch = loaded.status === 'mismatch' ? loaded.reason : null;
  const client = createJevClient({
    apiKey,
    pin,
    rulebookVersion: composed.rulebook.version,
    timeoutMs: 8_000,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...pluginDataPaths(options.env),
  });
  const result = await runSemanticRules(rules, files, { client, fitted, uncalibrated: composed.uncalibrated || fittedMismatch !== null, hunksByPath });
  const warnings = [...result.warnings];
  if (fittedMismatch !== null) {
    warnings.push(`fitted-mismatch for ${pin}: ${fittedMismatch}; semantic decisions are uncalibrated and never deny`);
  }
  if (fitted === null) {
    warnings.push(`no fitted thresholds for ${pin} (calibration/fitted/${pin}.json); semantic decisions are advisory and never deny`);
  }
  return {
    findings: result.findings,
    warnings,
    applied: result.applied,
    summary: { requests: result.requests, cached: result.cached, inputTokens: result.inputTokens, undecided: result.undecided },
  };
}

async function buildReport(
  composed: ComposedRulebook,
  rulebookPath: string,
  files: SourceFile[],
  hunksByPath: Record<string, Hunk[]>,
  args: ParsedArgs,
  io: CliIo,
  options: CliOptions,
): Promise<Report> {
  const skipped: Report['skipped'] = { semantic: [], runtime: [] };
  if (args.classes.includes('runtime')) {
    skipped.runtime = composed.rules.filter((rule) => rule.class === 'runtime').map((rule) => rule.id);
    if (skipped.runtime.length > 0) {
      io.stderr(`rule class 'runtime' is not implemented in this version; skipped ${skipped.runtime.length} rule(s)\n`);
    }
  }

  const staticResult = args.classes.includes('static')
    ? runStaticRules(composed.rules, files, { projectFiles: () => projectSources(options.cwd) })
    : { findings: [], warnings: [], applied: {} };

  const report: Report = {
    rulebook: { id: composed.rulebook.id, version: composed.rulebook.version, path: rulebookPath, pin: composed.rulebook.model.pin },
    uncalibrated: composed.uncalibrated,
    warnings: [...composed.warnings, ...staticResult.warnings],
    files: files.length,
    findings: [...staticResult.findings],
    skipped,
  };
  const explain: Record<string, string[]> = { ...staticResult.applied };

  if (args.classes.includes('semantic')) {
    const semantic = await runSemantic(composed, files, hunksByPath, io, options);
    report.findings.push(...semantic.findings);
    report.warnings.push(...semantic.warnings);
    report.semantic = semantic.summary;
    if (semantic.summary.skippedReason !== undefined) {
      skipped.semantic = composed.rules.filter((rule) => rule.class === 'semantic').map((rule) => rule.id);
    }
    if (args.explain) {
      const plan = planSemanticRequests(composed.rules, files, hunksByPath);
      for (const [path, ruleIds] of Object.entries(plan.applied)) {
        explain[path] = [...(explain[path] ?? []), ...ruleIds];
      }
      report.explainSemantic = explainRequests(plan);
    }
  }

  sortFindings(report.findings);
  if (args.explain) {
    report.explain = explain;
  }
  return report;
}

function exitCode(report: Report, args: ParsedArgs): number {
  if (!args.strict) {
    return 0;
  }
  const staticFail = report.findings.some((finding) => !isSemantic(finding) && finding.severity === 'FAIL');
  const deny = report.findings.some((finding) => isSemantic(finding) && finding.decision === 'deny');
  if (staticFail || deny) {
    return 1;
  }
  const uncertain = report.findings.some((finding) => isSemantic(finding) && (finding.decision === 'uncertain' || finding.decision === 'uncalibrated'));
  const unanswered = (report.semantic?.undecided.length ?? 0) > 0;
  return args.failOnUncertain && (uncertain || unanswered) ? 3 : 0;
}

const EXPORT_LOGS_USAGE = `Usage: nestjs-hexagonal-check export-logs --since <date> [--out <file>]

  Aggregates the hook decisions logged under $CLAUDE_PLUGIN_DATA/logs/hooks-YYYYMMDD.jsonl
  since <date> (ISO 8601): entries, p50/p95 latency per hook, decisions by kind,
  binary sources and semantic uncertain/uncalibrated rates. Writes JSON to --out or stdout.
`;

function runExportLogs(argv: string[], io: CliIo, options: CliOptions): number {
  let since: string | undefined;
  let out: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--since' && value !== undefined) {
      since = value;
      i += 1;
    } else if (arg === '--out' && value !== undefined) {
      out = value;
      i += 1;
    } else {
      io.stderr(`unknown option '${arg}'\n${EXPORT_LOGS_USAGE}`);
      return 2;
    }
  }
  if (since === undefined || Number.isNaN(Date.parse(since))) {
    io.stderr(`--since <date> is required and must parse as a date\n${EXPORT_LOGS_USAGE}`);
    return 2;
  }
  const sinceDate = new Date(since);
  const until = new Date();
  const summary = summarizeHookLogs(readHookLogs(resolveDataDir(options.env), sinceDate), sinceDate, until);
  const text = `${JSON.stringify(summary, null, 2)}\n`;
  if (out === undefined) {
    io.stdout(text);
  } else {
    const target = resolve(options.cwd, out);
    writeFileSync(target, text);
    io.stderr(`wrote ${summary.entries} entr${summary.entries === 1 ? 'y' : 'ies'} to ${target}\n`);
  }
  return 0;
}

export async function runCli(argv: string[], io: CliIo, options: CliOptions): Promise<number> {
  if (argv[0] === 'export-logs') {
    return runExportLogs(argv.slice(1), io, options);
  }
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 2;
  }

  if (args.help) {
    io.stdout(USAGE);
    return 0;
  }

  if (options.env.NESTJS_HEXAGONAL_DISABLE === '1') {
    io.stderr('NESTJS_HEXAGONAL_DISABLE=1, nothing to do\n');
    return 0;
  }

  try {
    const { path: rulebookPath, composed } = loadProjectRulebook({
      cwd: options.cwd,
      env: options.env,
      pluginRoot: options.pluginRoot,
      ...(args.rulebook !== undefined ? { rulebook: args.rulebook } : {}),
      ...(args.projectRulebook !== undefined ? { projectRulebook: args.projectRulebook } : {}),
    });

    if (args.files.length === 0 && args.diff === undefined) {
      throw new UsageError('pass --files <glob...> or --diff <base>');
    }
    const paths = args.diff !== undefined ? changedFiles(args.diff, options.cwd) : expandGlobs(args.files, options.cwd);
    const hunksByPath = args.diff !== undefined && args.classes.includes('semantic') ? changedHunks(args.diff, options.cwd) : {};
    const files = readSources(paths, options.cwd);
    if (files.length === 0) {
      io.stderr(`warning: no files matched ${args.diff !== undefined ? `--diff ${args.diff}` : args.files.join(' ')}; nothing was checked\n`);
    }

    const report = await buildReport(composed, rulebookPath, files, hunksByPath, args, io, options);
    for (const warning of report.warnings) {
      io.stderr(`warning: ${warning}\n`);
    }
    io.stdout(args.format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : formatText(report));
    return exitCode(report, args);
  } catch (error) {
    if (error instanceof UsageError || error instanceof RulebookNotFoundError) {
      io.stderr(`${error.message}\n${USAGE}`);
      return 2;
    }
    if (error instanceof RulebookCompositionError || error instanceof FittedFileError) {
      io.stderr(`${error.message}\n`);
      return 2;
    }
    throw error;
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  return import.meta.url === pathToFileURL(isAbsolute(entry) ? entry : resolve(entry)).href;
}

if (isMainModule()) {
  const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const code = await runCli(
    process.argv.slice(2),
    { stdout: (text) => process.stdout.write(text), stderr: (text) => process.stderr.write(text) },
    { cwd: process.cwd(), env: process.env, pluginRoot },
  );
  process.exitCode = code;
}
