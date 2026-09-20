import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  RulebookCompositionError,
  composeRulebook,
  createDirectoryResolver,
  readRulebookFile,
  rulebookPathForId,
  type ComposedRulebook,
} from './lib/compose.ts';
import { registerBuiltinExecutors } from './lib/executors/index.ts';
import { matchGlob, normalizePath } from './lib/scope.ts';
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
}

interface ParsedArgs {
  rulebook?: string;
  projectRulebook?: string;
  files: string[];
  diff?: string;
  classes: RuleClass[];
  format: 'json' | 'text';
  strict: boolean;
  explain: boolean;
  hook?: string;
  help: boolean;
}

class UsageError extends Error {}

const USAGE = `Usage: nestjs-hexagonal-check [options]

  --rulebook <path|id>        rulebook to run; an id resolves to <plugin>/rulebooks/<id>.rulebook.yaml
  --project-rulebook <path>   project rulebook (default: $NESTJS_HEXAGONAL_RULEBOOK or $CLAUDE_PROJECT_DIR/.claude/rulebook.yaml)
  --files <glob...>           files to check, as globs relative to the current directory
  --diff <base>               check the files changed since <base> (git diff --name-only <base>)
  --classes <list>            comma-separated rule classes to run (default: static)
  --format json|text          output format (default: text)
  --strict                    exit 1 when any FAIL finding exists
  --explain                   list the rules applied to each file
  --help                      show this message
`;

const IGNORED_DIRECTORIES = new Set(['node_modules', '.git']);
const RULE_CLASSES: RuleClass[] = ['static', 'semantic', 'runtime'];

function isRuleClass(value: string): value is RuleClass {
  return RULE_CLASSES.some((entry) => entry === value);
}

export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { files: [], classes: ['static'], format: 'text', strict: false, explain: false, help: false };
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
      case '--explain':
        parsed.explain = true;
        break;
      case '--hook':
        parsed.hook = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : '';
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

function resolveRootRulebook(args: ParsedArgs, options: CliOptions): string {
  const rulebooksDir = join(options.pluginRoot, 'rulebooks');
  if (args.rulebook !== undefined) {
    const asPath = resolve(options.cwd, args.rulebook);
    if (/\.ya?ml$/.test(args.rulebook) || existsSync(asPath)) {
      return asPath;
    }
    const byId = rulebookPathForId(rulebooksDir, args.rulebook);
    if (existsSync(byId)) {
      return byId;
    }
    throw new UsageError(`rulebook '${args.rulebook}' is neither a file nor an id under ${rulebooksDir}`);
  }

  const candidates: Array<{ path: string; origin: string }> = [];
  if (args.projectRulebook !== undefined) {
    const path = resolve(options.cwd, args.projectRulebook);
    if (!existsSync(path)) {
      throw new UsageError(`--project-rulebook ${args.projectRulebook} does not exist (${path})`);
    }
    return path;
  }
  const fromEnv = options.env.NESTJS_HEXAGONAL_RULEBOOK;
  if (fromEnv !== undefined && fromEnv !== '') {
    candidates.push({ path: resolve(options.cwd, fromEnv), origin: 'NESTJS_HEXAGONAL_RULEBOOK' });
  }
  const projectDir = options.env.CLAUDE_PROJECT_DIR ?? options.cwd;
  candidates.push({ path: join(projectDir, '.claude', 'rulebook.yaml'), origin: '.claude/rulebook.yaml' });

  for (const candidate of candidates) {
    if (existsSync(candidate.path)) {
      return candidate.path;
    }
  }
  throw new UsageError(
    `no rulebook found: pass --rulebook <path|id>, --project-rulebook <path>, set NESTJS_HEXAGONAL_RULEBOOK or create ${join(projectDir, '.claude', 'rulebook.yaml')}`,
  );
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
  const diff = execFileSync('git', ['diff', '--name-only', '--relative', '--diff-filter=ACMR', base], { cwd, encoding: 'utf8' });
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd, encoding: 'utf8' });
  const paths = `${diff}\n${untracked}`
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => existsSync(resolve(cwd, line)) && statSync(resolve(cwd, line)).isFile())
    .map((line) => normalizePath(line));
  return [...new Set(paths)].sort();
}

const PROJECT_TREE_IGNORED = new Set(['node_modules', '.git', 'dist']);
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

function projectRoot(cwd: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || cwd;
  } catch {
    return cwd;
  }
}

function walkTree(dir: string, cwd: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (PROJECT_TREE_IGNORED.has(entry.name)) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTree(full, cwd, out);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      out.push(normalizePath(relative(cwd, full)));
    }
  }
}

function projectSources(cwd: string): SourceFile[] {
  const paths: string[] = [];
  walkTree(projectRoot(cwd), cwd, paths);
  return readSources(paths, cwd);
}

function readSources(paths: string[], cwd: string): SourceFile[] {
  return paths.map((path) => ({ path, content: readFileSync(resolve(cwd, path), 'utf8') }));
}

interface Report {
  rulebook: { id: string; version: string; path: string };
  uncalibrated: boolean;
  warnings: string[];
  files: number;
  findings: Finding[];
  skipped: { semantic: string[]; runtime: string[] };
  explain?: Record<string, string[]>;
}

function formatText(report: Report): string {
  const lines: string[] = [];
  for (const finding of report.findings) {
    const location = finding.line === undefined ? finding.path : `${finding.path}:${finding.line}`;
    lines.push(`${location} ${finding.severity} ${finding.ruleId}: ${finding.evidence}`);
    lines.push(`  fix: ${finding.fix}`);
  }
  if (report.explain) {
    lines.push('');
    for (const [path, ruleIds] of Object.entries(report.explain)) {
      lines.push(`${path}: ${ruleIds.join(', ')}`);
    }
  }
  const fails = report.findings.filter((finding) => finding.severity === 'FAIL').length;
  const warns = report.findings.length - fails;
  const calibration = report.uncalibrated ? ', uncalibrated' : '';
  lines.push('');
  lines.push(`${fails} FAIL, ${warns} WARN in ${report.files} file(s) (rulebook ${report.rulebook.id} ${report.rulebook.version}${calibration})`);
  return `${lines.join('\n')}\n`;
}

function buildReport(composed: ComposedRulebook, rulebookPath: string, files: SourceFile[], args: ParsedArgs, io: CliIo, cwd: string): Report {
  const skipped: Report['skipped'] = { semantic: [], runtime: [] };
  for (const cls of args.classes) {
    if (cls === 'static') {
      continue;
    }
    const ids = composed.rules.filter((rule) => rule.class === cls).map((rule) => rule.id);
    skipped[cls] = ids;
    if (ids.length > 0) {
      io.stderr(`rule class '${cls}' is not implemented in this version; skipped ${ids.length} rule(s)\n`);
    }
  }

  const staticResult = args.classes.includes('static')
    ? runStaticRules(composed.rules, files, { projectFiles: () => projectSources(cwd) })
    : { findings: [], warnings: [], applied: {} };

  const report: Report = {
    rulebook: { id: composed.rulebook.id, version: composed.rulebook.version, path: rulebookPath },
    uncalibrated: composed.uncalibrated,
    warnings: [...composed.warnings, ...staticResult.warnings],
    files: files.length,
    findings: staticResult.findings.sort((a, b) => a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0)),
    skipped,
  };
  if (args.explain) {
    report.explain = staticResult.applied;
  }
  return report;
}

export function runCli(argv: string[], io: CliIo, options: CliOptions): number {
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

  if (args.hook !== undefined) {
    io.stderr(`hook '${args.hook}' is not implemented in this version\n`);
    return 0;
  }

  try {
    const rulebookPath = resolveRootRulebook(args, options);
    const { rulebook } = readRulebookFile(rulebookPath);
    registerBuiltinExecutors();
    const composed = composeRulebook(rulebook, createDirectoryResolver(join(options.pluginRoot, 'rulebooks')));

    if (args.files.length === 0 && args.diff === undefined) {
      throw new UsageError('pass --files <glob...> or --diff <base>');
    }
    const paths = args.diff !== undefined ? changedFiles(args.diff, options.cwd) : expandGlobs(args.files, options.cwd);
    const files = readSources(paths, options.cwd);
    if (files.length === 0) {
      io.stderr(`warning: no files matched ${args.diff !== undefined ? `--diff ${args.diff}` : args.files.join(' ')}; nothing was checked\n`);
    }

    const report = buildReport(composed, rulebookPath, files, args, io, options.cwd);
    for (const warning of report.warnings) {
      io.stderr(`warning: ${warning}\n`);
    }
    io.stdout(args.format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : formatText(report));

    const hasFail = report.findings.some((finding) => finding.severity === 'FAIL');
    return args.strict && hasFail ? 1 : 0;
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`${error.message}\n${USAGE}`);
      return 2;
    }
    if (error instanceof RulebookCompositionError) {
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
  const code = runCli(
    process.argv.slice(2),
    { stdout: (text) => process.stdout.write(text), stderr: (text) => process.stderr.write(text) },
    { cwd: process.cwd(), env: process.env, pluginRoot },
  );
  process.exitCode = code;
}
