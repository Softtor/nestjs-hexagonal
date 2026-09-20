import './helpers/no-network.ts';
import { assertNetworkForbidden } from './helpers/no-network.ts';
import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseUnifiedDiff, runCli, type CliIo } from '../check.ts';
import type { FetchLike } from '../lib/jev-client.ts';
import { readRulebookFile, sha256Of } from '../lib/compose.ts';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

const PLUGIN_ROOT = resolve(import.meta.dir, '../..');
const GOLDEN_ROOT = join(PLUGIN_ROOT, 'calibration', 'golden');

interface Captured extends CliIo {
  out: string[];
  err: string[];
}

function capture(): Captured {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (text) => {
      out.push(text);
    },
    stderr: (text) => {
      err.push(text);
    },
  };
}

interface JsonReport {
  rulebook: { id: string; version: string };
  uncalibrated: boolean;
  warnings: string[];
  findings: Array<{ ruleId: string; severity: string; path: string; line?: number }>;
  skipped: { semantic: string[]; runtime: string[] };
  explain?: Record<string, string[]>;
}

function isJsonReport(value: unknown): value is JsonReport {
  return typeof value === 'object' && value !== null && 'findings' in value && 'skipped' in value;
}

const EMPTY_FITTED_DIR = mkdtempSync(join(tmpdir(), 'no-fitted-'));

async function run(args: string[], env: Record<string, string | undefined> = {}, cwd = PLUGIN_ROOT, fetchImpl?: FetchLike, fittedDir = EMPTY_FITTED_DIR): Promise<{ code: number; io: Captured }> {
  const io = capture();
  const code = await runCli(args, io, { cwd, env, pluginRoot: PLUGIN_ROOT, fittedDir, ...(fetchImpl ? { fetchImpl } : {}) });
  return { code, io };
}

async function runJson(args: string[], env: Record<string, string | undefined> = {}, cwd = PLUGIN_ROOT, fetchImpl?: FetchLike, fittedDir?: string): Promise<{ code: number; report: JsonReport; io: Captured }> {
  const { code, io } = await run([...args, '--format', 'json'], env, cwd, fetchImpl, fittedDir);
  const parsed: unknown = JSON.parse(io.out.join(''));
  if (!isJsonReport(parsed)) {
    throw new Error(`unexpected report: ${io.out.join('')}`);
  }
  return { code, report: parsed, io };
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

const baseRulebooks = ['hexagonal', 'softtor-conventions'].map((id) => readRulebookFile(join(PLUGIN_ROOT, 'rulebooks', `${id}.rulebook.yaml`)));
const staticRules = baseRulebooks.flatMap(({ rulebook }) => rulebook.rules.filter((rule) => rule.class === 'static').map((rule) => ({ rule, rulebookId: rulebook.id })));

describe('golden fixtures', () => {
  it('cover every static rule with at least two good and two bad files', async () => {
    for (const { rule } of staticRules) {
      const good = listFiles(join(GOLDEN_ROOT, rule.id, 'good'));
      const bad = listFiles(join(GOLDEN_ROOT, rule.id, 'bad'));
      expect(good.length, `${rule.id} good fixtures`).toBeGreaterThanOrEqual(2);
      expect(bad.length, `${rule.id} bad fixtures`).toBeGreaterThanOrEqual(2);
    }
  });

  for (const { rule, rulebookId } of staticRules) {
    it(`${rule.id}: bad fixtures produce findings, good fixtures do not`, async () => {
      const badGlob = `calibration/golden/${rule.id}/bad/**`;
      const goodGlob = `calibration/golden/${rule.id}/good/**`;
      const bad = await runJson(['--rulebook', rulebookId, '--files', badGlob]);
      const badHits = bad.report.findings.filter((finding) => finding.ruleId === rule.id);
      expect(badHits.length, `${rule.id} bad`).toBeGreaterThan(0);
      for (const finding of badHits) {
        expect(finding.severity).toBe(rule.severity);
      }
      const good = await runJson(['--rulebook', rulebookId, '--files', goodGlob]);
      const goodHits = good.report.findings.filter((finding) => finding.ruleId === rule.id);
      expect(goodHits, `${rule.id} good`).toEqual([]);
    });
  }
});

describe('examples', () => {
  it('order-bounded-context passes the hexagonal rulebook with zero FAIL', async () => {
    const { code, report } = await runJson(['--rulebook', 'hexagonal', '--files', 'examples/**/*.ts', '--strict']);
    const fails = report.findings.filter((finding) => finding.severity === 'FAIL');
    expect(fails).toEqual([]);
    expect(code).toBe(0);
    expect(report.warnings).toEqual([]);
  });
});

describe('runCli', () => {
  it('never touches the network', async () => {
    await runJson(['--rulebook', 'hexagonal', '--files', 'examples/**/*.ts']);
    assertNetworkForbidden();
  });

  it('reports the runtime class as not implemented and skips semantic rules without a key', async () => {
    const { report, io, code } = await runJson(['--rulebook', 'hexagonal', '--files', 'examples/**/*.ts', '--classes', 'static,semantic,runtime'], { TYPESAFE_API_KEY: undefined });
    expect(code).toBe(0);
    expect(report.skipped.semantic).toContain('hex/handler-no-business-rules');
    expect(report.skipped.runtime).toContain('hex/tests-coverage');
    expect(io.err.join('')).toContain('not implemented in this version');
    expect(io.err.join('')).toContain('TYPESAFE_API_KEY is not set; skipped 5 semantic rule(s)');
    assertNetworkForbidden();
  });

  it('exits 1 with --strict when a FAIL exists and 0 otherwise', async () => {
    const glob = 'calibration/golden/hex/domain-no-nest-decorators/bad/**';
    expect((await run(['--rulebook', 'hexagonal', '--files', glob])).code).toBe(0);
    expect((await run(['--rulebook', 'hexagonal', '--files', glob, '--strict'])).code).toBe(1);
  });

  it('prints text findings with path, line, severity, rule id and fix', async () => {
    const { io } = await run(['--rulebook', 'hexagonal', '--files', 'calibration/golden/hex/no-circular-import/bad/**', '--format', 'text']);
    const text = io.out.join('');
    expect(text).toMatch(/calibration\/golden\/hex\/no-circular-import\/bad\/\S+:\d+ FAIL hex\/no-circular-import/);
    expect(text).toContain('fix:');
    expect(text).toMatch(/\d+ FAIL/);
  });

  it('lists the rules applied per file with --explain', async () => {
    const { report } = await runJson(['--rulebook', 'hexagonal', '--files', 'examples/**/domain/entities/order.entity.ts', '--explain']);
    expect(report.explain?.['examples/order-bounded-context/domain/entities/order.entity.ts']).toContain('hex/domain-no-nest-decorators');
    expect(report.explain?.['examples/order-bounded-context/domain/entities/order.entity.ts']).toContain('hex/entity-unique-id');
  });

  it('resolves the project rulebook from flag, env or .claude/rulebook.yaml and composes extends', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hex-project-'));
    mkdirSync(join(dir, '.claude'));
    mkdirSync(join(dir, 'src', 'orders', 'domain'), { recursive: true });
    writeFileSync(join(dir, 'src', 'orders', 'domain', 'order.service.ts'), "import { Injectable } from '@nestjs/common';\n@Injectable()\nexport class OrderService {}\n");
    const hexText = readFileSync(join(PLUGIN_ROOT, 'rulebooks', 'hexagonal.rulebook.yaml'), 'utf8');
    const projectYaml = [
      '$schema: nestjs-hexagonal/rulebook@1',
      'id: acme',
      'version: 0.1.0',
      'extends:',
      `  - { id: hexagonal, version: 1.2.0, sha256: ${sha256Of(hexText)} }`,
      'model: { provider: typesafe, pin: jev-1.13.0 }',
      'rules: []',
      'overrides:',
      "  - { id: hex/domain-no-nest-decorators, severity: WARN }",
      '',
    ].join('\n');
    writeFileSync(join(dir, '.claude', 'rulebook.yaml'), projectYaml);

    const viaDefault = await runJson(['--files', 'src/**/*.ts'], { CLAUDE_PROJECT_DIR: dir }, dir);
    expect(viaDefault.report.rulebook.id).toBe('acme');
    expect(viaDefault.report.uncalibrated).toBe(false);
    expect(viaDefault.report.findings).toHaveLength(1);
    expect(viaDefault.report.findings[0]).toMatchObject({ ruleId: 'hex/domain-no-nest-decorators', severity: 'WARN', line: 1 });

    writeFileSync(join(dir, 'other.yaml'), projectYaml.replace('id: acme', 'id: other'));
    const viaEnv = await runJson(['--files', 'src/**/*.ts'], { NESTJS_HEXAGONAL_RULEBOOK: 'other.yaml' }, dir);
    expect(viaEnv.report.rulebook.id).toBe('other');
    const viaFlag = await runJson(['--project-rulebook', 'other.yaml', '--files', 'src/**/*.ts'], {}, dir);
    expect(viaFlag.report.rulebook.id).toBe('other');
  });

  it('marks a stale extends stamp as uncalibrated with a warning and still runs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hex-stale-'));
    writeFileSync(
      join(dir, 'rulebook.yaml'),
      [
        '$schema: nestjs-hexagonal/rulebook@1',
        'id: stale',
        'version: 0.1.0',
        `extends: [{ id: hexagonal, version: 1.0.0, sha256: '${'0'.repeat(64)}' }]`,
        'model: { provider: typesafe, pin: jev-1.13.0 }',
        '',
      ].join('\n'),
    );
    const { report, code } = await runJson(['--project-rulebook', 'rulebook.yaml', '--files', 'nothing/**'], {}, dir);
    expect(code).toBe(0);
    expect(report.uncalibrated).toBe(true);
    expect(report.warnings[0]).toMatch(/^rulebook-mismatch/);
  });

  it('fails with exit 2 and a message when no rulebook can be found or a flag is unknown', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hex-empty-'));
    const missing = await run(['--files', 'src/**'], {}, dir);
    expect(missing.code).toBe(2);
    expect(missing.io.err.join('')).toContain('rulebook');
    const unknown = await run(['--rulebook', 'hexagonal', '--files', 'x', '--bogus']);
    expect(unknown.code).toBe(2);
    const unknownId = await run(['--rulebook', 'does-not-exist', '--files', 'x']);
    expect(unknownId.code).toBe(2);
  });

  it('uses git diff --name-only for --diff', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hex-git-'));
    const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
    git('init', '-q', '-b', 'main');
    mkdirSync(join(dir, 'bc', 'domain'), { recursive: true });
    writeFileSync(join(dir, 'bc', 'domain', 'clean.ts'), 'export const clean = 1;\n');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    writeFileSync(join(dir, 'bc', 'domain', 'dirty.ts'), "import { Injectable } from '@nestjs/common';\n");
    git('add', '.');
    git('commit', '-q', '-m', 'dirty');
    const { report } = await runJson(['--rulebook', 'hexagonal', '--diff', 'HEAD~1'], {}, dir);
    expect(report.findings.map((finding) => finding.path)).toEqual(['bc/domain/dirty.ts']);
  });

  it('resolves --diff paths from a subdirectory and includes untracked files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hex-git-sub-'));
    const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
    git('init', '-q', '-b', 'main');
    mkdirSync(join(dir, 'bc', 'domain'), { recursive: true });
    writeFileSync(join(dir, 'bc', 'domain', 'clean.ts'), 'export const clean = 1;\n');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    writeFileSync(join(dir, 'bc', 'domain', 'dirty.ts'), "import { Injectable } from '@nestjs/common';\n");
    git('add', '.');
    git('commit', '-q', '-m', 'dirty');
    writeFileSync(join(dir, 'bc', 'domain', 'untracked.ts'), "import { Module } from '@nestjs/common';\n");

    const fromRoot = await runJson(['--rulebook', 'hexagonal', '--diff', 'HEAD~1'], {}, dir);
    expect(fromRoot.report.findings.map((finding) => finding.path)).toEqual(['bc/domain/dirty.ts', 'bc/domain/untracked.ts']);

    const fromSubdir = await runJson(['--rulebook', 'hexagonal', '--diff', 'HEAD~1'], {}, join(dir, 'bc'));
    expect(fromSubdir.report.findings.map((finding) => finding.path)).toEqual(['domain/dirty.ts', 'domain/untracked.ts']);
    expect(fromSubdir.report.findings.map((finding) => finding.ruleId)).toEqual(fromRoot.report.findings.map((finding) => finding.ruleId));
  });

  it('warns on stderr when --strict runs over zero eligible files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hex-git-empty-'));
    const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
    git('init', '-q', '-b', 'main');
    writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    const { code, io } = await run(['--rulebook', 'hexagonal', '--diff', 'HEAD', '--strict'], {}, dir);
    expect(code).toBe(0);
    expect(io.err.join('')).toContain('no files');
    const globs = await run(['--rulebook', 'hexagonal', '--files', 'nothing/**', '--strict'], {}, dir);
    expect(globs.io.err.join('')).toContain('no files');
  });

  it('counts over the git tree when --diff narrows the checked set', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hex-git-tree-'));
    const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
    git('init', '-q', '-b', 'main');
    mkdirSync(join(dir, 'src', 'x', 'application', 'helpers'), { recursive: true });
    mkdirSync(join(dir, 'src', 'x', 'application', 'commands'), { recursive: true });
    writeFileSync(join(dir, 'src', 'x', 'application', 'helpers', 'normalize.ts'), 'export function normalizeName(name: string): string {\n  return name.trim();\n}\n');
    writeFileSync(join(dir, 'src', 'x', 'application', 'commands', 'a.handler.ts'), "import { normalizeName } from '../helpers/normalize';\nnormalizeName('a');\n");
    writeFileSync(join(dir, 'src', 'x', 'application', 'commands', 'b.handler.ts'), "import { normalizeName } from '../helpers/normalize';\nnormalizeName('b');\n");
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    writeFileSync(join(dir, 'src', 'x', 'application', 'helpers', 'normalize.ts'), 'export function normalizeName(name: string): string {\n  return name.trim().toLowerCase();\n}\n');
    writeFileSync(join(dir, 'src', 'x', 'application', 'commands', 'a.handler.ts'), "import { normalizeName } from '../helpers/normalize';\nnormalizeName('A');\n");
    git('add', '.');
    git('commit', '-q', '-m', 'touch helper and one caller');
    const { report } = await runJson(['--rulebook', 'hexagonal', '--diff', 'HEAD~1'], {}, join(dir, 'src'));
    expect(report.findings.filter((finding) => finding.ruleId === 'hex/no-overengineering-static')).toEqual([]);
  });

  it('walks a directory passed to --files', async () => {
    const { report } = await runJson(['--rulebook', 'hexagonal', '--files', 'calibration/golden/hex/no-circular-import/bad']);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.findings.every((finding) => finding.path.startsWith('calibration/golden/hex/no-circular-import/bad/'))).toBe(true);
  });

  it('exits 2 when --project-rulebook points to a missing file', async () => {
    const { code, io } = await run(['--project-rulebook', 'missing.yaml', '--files', 'examples/**/*.ts']);
    expect(code).toBe(2);
    expect(io.err.join('')).toContain('missing.yaml');
  });

  it('keeps identifiers-english case-sensitive on the stems', async () => {
    const rule = baseRulebooks.flatMap(({ rulebook }) => rulebook.rules).find((entry) => entry.id === 'softtor/identifiers-english');
    expect(rule?.check?.kind === 'regex' && rule.check.flags.includes('i')).toBe(false);
  });


  it('project.example stamps match the shipped base rulebooks', async () => {
    const { report } = await runJson(['--project-rulebook', 'rulebooks/project.example.rulebook.yaml', '--files', 'examples/**/*.ts']);
    expect(report.uncalibrated).toBe(false);
    expect(report.warnings).toEqual([]);
  });
});

describe('node fallback', () => {
  it('runs check.ts under node --experimental-strip-types', async () => {
    const output = execFileSync(
      'node',
      ['--experimental-strip-types', '--no-warnings', join(PLUGIN_ROOT, 'scripts', 'check.ts'), '--rulebook', 'hexagonal', '--files', 'calibration/golden/hex/no-circular-import/bad/**', '--format', 'json'],
      { cwd: PLUGIN_ROOT, encoding: 'utf8' },
    );
    const parsed: unknown = JSON.parse(output);
    expect(isJsonReport(parsed) && parsed.findings.length > 0).toBe(true);
  });
});

const SEMANTIC_KEY = 'sk-cli-secret-key';

function cannedFetch(answerFor: (key: string) => unknown, calls: string[] = []): FetchLike {
  return (_url, init) => {
    const body: unknown = JSON.parse(String(init.body));
    calls.push(String(init.body));
    const questions = typeof body === 'object' && body !== null && 'questions' in body ? body.questions : {};
    const answers: Record<string, unknown> = {};
    for (const key of Object.keys(typeof questions === 'object' && questions !== null ? questions : {})) {
      answers[key] = answerFor(key);
    }
    return Promise.resolve(new Response(JSON.stringify({ model: 'jev-1.13.0', answers, usage: { input_tokens: 321, output_tokens: 4 } }), { status: 200, headers: { 'content-type': 'application/json' } }));
  };
}

const noulOrNone = (p: number) => (key: string): unknown => (key === 'hex/no-overengineering' ? { type: 'choice', choice: 'none', confidence: 0.9, probabilities: { none: 0.9, other: 0.1 } } : { type: 'noul', noul: p });

interface SemanticJsonReport extends JsonReport {
  findings: Array<{ ruleId: string; severity: string; path: string; line?: number; class?: string; decision?: string; calibrated?: boolean; evidence?: string }>;
  semantic?: { requests: number; cached: number; inputTokens: number; skippedReason?: string; undecided?: Array<{ path: string; ruleIds: string[]; reason: string }> };
  explainSemantic?: Array<{ path: string; slice: string; code: string; questions: Record<string, { type: string; instructions: string }> }>;
}

function asSemanticReport(report: JsonReport): SemanticJsonReport {
  return report;
}

describe('runCli --classes semantic', () => {
  const handler = 'examples/order-bounded-context/application/commands/cancel-order.handler.ts';

  it('skips semantic rules with a one-line notice and exit 0 when the key is absent', async () => {
    const { code, io, report } = await runJson(['--rulebook', 'hexagonal', '--files', handler, '--classes', 'semantic', '--strict'], { TYPESAFE_API_KEY: undefined });
    expect(code).toBe(0);
    expect(io.err.join('')).toBe('TYPESAFE_API_KEY is not set; skipped 5 semantic rule(s)\n');
    expect(report.findings).toEqual([]);
    expect(asSemanticReport(report).semantic?.skippedReason).toContain('TYPESAFE_API_KEY');
    assertNetworkForbidden();
  });

  it('reads the plugin option before the environment key and treats an empty key as absent', async () => {
    const calls: string[] = [];
    const { code, io } = await runJson(['--rulebook', 'hexagonal', '--files', handler, '--classes', 'semantic'], { CLAUDE_PLUGIN_OPTION_TYPESAFE_API_KEY: 'sk-from-option', TYPESAFE_API_KEY: '' }, PLUGIN_ROOT, cannedFetch(noulOrNone(0.1), calls));
    expect(code).toBe(0);
    expect(io.err.join('')).not.toContain('TYPESAFE_API_KEY is not set');
    expect(calls.length).toBeGreaterThan(0);
    const empty = await runJson(['--rulebook', 'hexagonal', '--files', handler, '--classes', 'semantic'], { CLAUDE_PLUGIN_OPTION_TYPESAFE_API_KEY: '', TYPESAFE_API_KEY: '' });
    expect(empty.io.err.join('')).toContain('TYPESAFE_API_KEY is not set');
  });

  it('does nothing when NESTJS_HEXAGONAL_DISABLE=1', async () => {
    const { code, io } = await run(['--rulebook', 'hexagonal', '--files', handler, '--classes', 'static,semantic'], { NESTJS_HEXAGONAL_DISABLE: '1', TYPESAFE_API_KEY: SEMANTIC_KEY });
    expect(code).toBe(0);
    expect(io.out).toEqual([]);
    expect(io.err.join('')).toContain('NESTJS_HEXAGONAL_DISABLE=1');
    assertNetworkForbidden();
  });

  it('asks Jev through the injected fetch, reports advisory findings and never prints the key', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plugin-data-'));
    const calls: string[] = [];
    const { code, io, report } = await runJson(
      ['--rulebook', 'hexagonal', '--files', handler, '--classes', 'semantic', '--strict'],
      { TYPESAFE_API_KEY: SEMANTIC_KEY, CLAUDE_PLUGIN_DATA: dataDir },
      PLUGIN_ROOT,
      cannedFetch(noulOrNone(0.8), calls),
    );
    expect(code).toBe(0);
    const semantic = asSemanticReport(report);
    expect(semantic.findings).toEqual([
      expect.objectContaining({ ruleId: 'hex/handler-no-business-rules', class: 'semantic', decision: 'advise', calibrated: false, evidence: 'jev noul=0.80 decision=advise' }),
    ]);
    expect(semantic.semantic).toMatchObject({ requests: 2, cached: 0, inputTokens: 642 });
    expect(report.warnings.some((warning) => warning.includes('no fitted thresholds for jev-1.13.0'))).toBe(true);
    const everything = [...io.out, ...io.err, readFileSync(join(dataDir, 'jev.jsonl'), 'utf8')].join('');
    expect(everything).not.toContain(SEMANTIC_KEY);
    expect(readFileSync(join(dataDir, 'jev.jsonl'), 'utf8')).not.toContain('CancelOrderHandler');
    expect(calls.every((body) => body.includes('"model":"jev-1.13.0"'))).toBe(true);
    const again = await runJson(['--rulebook', 'hexagonal', '--files', handler, '--classes', 'semantic'], { TYPESAFE_API_KEY: SEMANTIC_KEY, CLAUDE_PLUGIN_DATA: dataDir }, PLUGIN_ROOT, cannedFetch(noulOrNone(0.8)));
    expect(asSemanticReport(again.report).semantic?.cached).toBe(2);
  });

  it('exits 3 with --strict --fail-on-uncertain on an uncertain answer and 0 without the flag', async () => {
    const uncertain = await runJson(['--rulebook', 'hexagonal', '--files', handler, '--classes', 'semantic', '--strict', '--fail-on-uncertain'], { TYPESAFE_API_KEY: SEMANTIC_KEY }, PLUGIN_ROOT, cannedFetch(noulOrNone(0.5)));
    expect(uncertain.code).toBe(3);
    expect(asSemanticReport(uncertain.report).findings[0]?.decision).toBe('uncertain');
    const lenient = await runJson(['--rulebook', 'hexagonal', '--files', handler, '--classes', 'semantic', '--strict'], { TYPESAFE_API_KEY: SEMANTIC_KEY }, PLUGIN_ROOT, cannedFetch(noulOrNone(0.5)));
    expect(lenient.code).toBe(0);
  });

  it('prints semantic groups, questions and the slice with --explain in text format, without the key', async () => {
    const { io } = await run(['--rulebook', 'hexagonal', '--files', handler, '--classes', 'semantic', '--explain'], { TYPESAFE_API_KEY: SEMANTIC_KEY }, PLUGIN_ROOT, cannedFetch(noulOrNone(0.8)));
    const text = io.out.join('');
    expect(text).toContain('semantic advise (1):');
    expect(text).toContain('[not calibrated]');
    expect(text).toContain(`${handler} [slice declaration]`);
    expect(text).toContain('hex/handler-no-business-rules (noul):');
    expect(text).toContain('state.code:');
    expect(text).toContain('semantic: 0 deny, 0 ask, 1 advise, 0 uncertain, 0 uncalibrated');
    expect(text).not.toContain(SEMANTIC_KEY);
  });

  it('never denies without fitted thresholds, so --strict stays green on a confident violation', async () => {
    const { code, report } = await runJson(['--rulebook', 'hexagonal', '--files', handler, '--classes', 'semantic', '--strict'], { TYPESAFE_API_KEY: SEMANTIC_KEY }, PLUGIN_ROOT, cannedFetch(noulOrNone(0.99)));
    expect(code).toBe(0);
    expect(asSemanticReport(report).findings[0]?.decision).toBe('advise');
  });
});

describe('runCli with fitted thresholds', () => {
  const handler = 'examples/order-bounded-context/application/commands/cancel-order.handler.ts';

  it('marks findings calibrated and applies the fitted ask cut', async () => {
    const fittedDir = mkdtempSync(join(tmpdir(), 'fitted-'));
    writeFileSync(join(fittedDir, 'jev-1.13.0.json'), JSON.stringify({ pin: 'jev-1.13.0', generatedAt: 'now', rules: { 'hex/handler-no-business-rules': { advise: 0.7, ask: 0.85, uncertain: { lo: 0.35, hi: 0.65 } } } }));
    const { code, report } = await runJson(['--rulebook', 'hexagonal', '--files', handler, '--classes', 'semantic', '--strict'], { TYPESAFE_API_KEY: SEMANTIC_KEY }, PLUGIN_ROOT, cannedFetch(noulOrNone(0.9)), fittedDir);
    expect(code).toBe(0);
    expect(asSemanticReport(report).findings).toEqual([expect.objectContaining({ ruleId: 'hex/handler-no-business-rules', decision: 'ask', calibrated: true })]);
    expect(report.warnings.some((warning) => warning.includes('no fitted thresholds'))).toBe(false);
  });

  it('loads the fitted file shipped in the plugin when no override is given', async () => {
    const io = capture();
    const code = await runCli(['--rulebook', 'hexagonal', '--files', handler, '--classes', 'semantic', '--format', 'json'], io, { cwd: PLUGIN_ROOT, env: { TYPESAFE_API_KEY: SEMANTIC_KEY }, pluginRoot: PLUGIN_ROOT, fetchImpl: cannedFetch(noulOrNone(0.99)) });
    expect(code).toBe(0);
    const parsed: unknown = JSON.parse(io.out.join(''));
    if (!isJsonReport(parsed)) throw new Error('unexpected report');
    const shipped = existsSync(join(PLUGIN_ROOT, 'calibration', 'fitted', 'jev-1.13.0.json'));
    expect(asSemanticReport(parsed).findings[0]?.calibrated).toBe(shipped);
  });
});

describe('runCli with a fitted file that does not match', () => {
  const handler = 'examples/order-bounded-context/application/commands/cancel-order.handler.ts';

  it('turns every outcome into uncalibrated with a warning when the fitted pin differs', async () => {
    const fittedDir = mkdtempSync(join(tmpdir(), 'fitted-'));
    writeFileSync(join(fittedDir, 'jev-1.13.0.json'), JSON.stringify({ pin: 'jev-1.12.0', generatedAt: 'now', rulebookVersion: '1.3.0', rules: { 'hex/handler-no-business-rules': { advise: 0.7, ask: 0.85 } } }));
    const { code, report } = await runJson(['--rulebook', 'hexagonal', '--files', handler, '--classes', 'semantic', '--strict'], { TYPESAFE_API_KEY: SEMANTIC_KEY }, PLUGIN_ROOT, cannedFetch(noulOrNone(0.99)), fittedDir);
    expect(code).toBe(0);
    expect(asSemanticReport(report).findings[0]).toMatchObject({ decision: 'uncalibrated' });
    expect(report.warnings.some((warning) => warning.includes('fitted-mismatch'))).toBe(true);
  });

  it('exits 2 with a clean message on a malformed fitted file', async () => {
    const fittedDir = mkdtempSync(join(tmpdir(), 'fitted-'));
    writeFileSync(join(fittedDir, 'jev-1.13.0.json'), '{ broken');
    const { code, io } = await run(['--rulebook', 'hexagonal', '--files', handler, '--classes', 'semantic'], { TYPESAFE_API_KEY: SEMANTIC_KEY }, PLUGIN_ROOT, cannedFetch(noulOrNone(0.5)), fittedDir);
    expect(code).toBe(2);
    expect(io.err.join('')).toContain('invalid fitted thresholds');
    expect(io.out).toEqual([]);
  });
});

describe('parseUnifiedDiff', () => {
  it('maps new-side hunk ranges by path', () => {
    const diff = ['diff --git src/a.ts src/a.ts', '--- src/a.ts', '+++ src/a.ts', '@@ -3,0 +4,2 @@', '+x', '+y', '@@ -10 +12 @@', '+z', 'diff --git src/b.ts src/b.ts', '--- src/b.ts', '+++ /dev/null', '@@ -1,3 +0,0 @@'].join('\n');
    expect(parseUnifiedDiff(diff)).toEqual({ 'src/a.ts': [{ start: 4, end: 5 }, { start: 12, end: 12 }] });
  });
});

describe('runCli undecided semantic batches', () => {
  const handler = 'examples/order-bounded-context/application/commands/cancel-order.handler.ts';
  const rejecting: FetchLike = () => Promise.resolve(new Response('{}', { status: 401 }));

  it('exits 3 with --strict --fail-on-uncertain when Jev could not answer, and 0 without the flag', async () => {
    const strictUncertain = await runJson(['--rulebook', 'hexagonal', '--files', handler, '--classes', 'semantic', '--strict', '--fail-on-uncertain'], { TYPESAFE_API_KEY: SEMANTIC_KEY }, PLUGIN_ROOT, rejecting);
    expect(strictUncertain.code).toBe(3);
    expect(asSemanticReport(strictUncertain.report).semantic?.undecided).toEqual([
      { path: handler, ruleIds: ['hex/handler-no-business-rules'], reason: 'http' },
      { path: handler, ruleIds: ['hex/no-overengineering'], reason: 'http' },
    ]);
    const strictOnly = await runJson(['--rulebook', 'hexagonal', '--files', handler, '--classes', 'semantic', '--strict'], { TYPESAFE_API_KEY: SEMANTIC_KEY }, PLUGIN_ROOT, rejecting);
    expect(strictOnly.code).toBe(0);
    const text = await run(['--rulebook', 'hexagonal', '--files', handler, '--classes', 'semantic'], { TYPESAFE_API_KEY: SEMANTIC_KEY }, PLUGIN_ROOT, rejecting);
    expect(text.io.out.join('')).toContain('semantic undecided (2):');
  });
});

describe('parseUnifiedDiff without prefixes', () => {
  it('keeps a path whose first segment is literally b', () => {
    const diff = ['diff --git b/x.ts b/x.ts', '--- b/x.ts', '+++ b/x.ts', '@@ -1 +1,2 @@', '+a', '+b'].join('\n');
    expect(parseUnifiedDiff(diff)).toEqual({ 'b/x.ts': [{ start: 1, end: 2 }] });
  });
});

describe('stamp subcommand', () => {
  interface Stamp {
    id: string;
    version: string;
    sha256: string;
  }
  function isStampList(value: unknown): value is { extends: Stamp[] } {
    return typeof value === 'object' && value !== null && 'extends' in value && Array.isArray(value.extends);
  }

  it('prints an extends block whose stamps match the shipped project example', async () => {
    const { code, io } = await run(['stamp', 'hexagonal', 'softtor-conventions']);
    expect(code).toBe(0);
    const printed: unknown = parseYaml(io.out.join(''));
    const example: unknown = parseYaml(readFileSync(join(PLUGIN_ROOT, 'rulebooks', 'project.example.rulebook.yaml'), 'utf8'));
    if (!isStampList(printed) || !isStampList(example)) {
      throw new Error('unexpected stamp output');
    }
    expect(printed.extends).toEqual(example.extends);
    for (const stamp of printed.extends) {
      const text = readFileSync(join(PLUGIN_ROOT, 'rulebooks', `${stamp.id}.rulebook.yaml`), 'utf8');
      expect(stamp.sha256).toBe(sha256Of(text));
    }
  });

  it('defaults to the hexagonal rulebook and rejects unknown ids', async () => {
    const single = await run(['stamp']);
    expect(single.code).toBe(0);
    expect(single.io.out.join('')).toContain('id: hexagonal');
    expect(single.io.out.join('')).not.toContain('softtor-conventions');
    const unknown = await run(['stamp', 'nope']);
    expect(unknown.code).toBe(2);
    expect(unknown.io.err.join('')).toContain("unknown rulebook 'nope'");
  });
});
