import './helpers/no-network.ts';
import { assertNetworkForbidden } from './helpers/no-network.ts';
import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runCli, type CliIo } from '../check.ts';
import { readRulebookFile, sha256Of } from '../lib/compose.ts';
import { readFileSync } from 'node:fs';

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

function run(args: string[], env: Record<string, string | undefined> = {}, cwd = PLUGIN_ROOT): { code: number; io: Captured } {
  const io = capture();
  const code = runCli(args, io, { cwd, env, pluginRoot: PLUGIN_ROOT });
  return { code, io };
}

function runJson(args: string[], env: Record<string, string | undefined> = {}, cwd = PLUGIN_ROOT): { code: number; report: JsonReport; io: Captured } {
  const { code, io } = run([...args, '--format', 'json'], env, cwd);
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
  it('cover every static rule with at least two good and two bad files', () => {
    for (const { rule } of staticRules) {
      const good = listFiles(join(GOLDEN_ROOT, rule.id, 'good'));
      const bad = listFiles(join(GOLDEN_ROOT, rule.id, 'bad'));
      expect(good.length, `${rule.id} good fixtures`).toBeGreaterThanOrEqual(2);
      expect(bad.length, `${rule.id} bad fixtures`).toBeGreaterThanOrEqual(2);
    }
  });

  for (const { rule, rulebookId } of staticRules) {
    it(`${rule.id}: bad fixtures produce findings, good fixtures do not`, () => {
      const badGlob = `calibration/golden/${rule.id}/bad/**`;
      const goodGlob = `calibration/golden/${rule.id}/good/**`;
      const bad = runJson(['--rulebook', rulebookId, '--files', badGlob]);
      const badHits = bad.report.findings.filter((finding) => finding.ruleId === rule.id);
      expect(badHits.length, `${rule.id} bad`).toBeGreaterThan(0);
      for (const finding of badHits) {
        expect(finding.severity).toBe(rule.severity);
      }
      const good = runJson(['--rulebook', rulebookId, '--files', goodGlob]);
      const goodHits = good.report.findings.filter((finding) => finding.ruleId === rule.id);
      expect(goodHits, `${rule.id} good`).toEqual([]);
    });
  }
});

describe('examples', () => {
  it('order-bounded-context passes the hexagonal rulebook with zero FAIL', () => {
    const { code, report } = runJson(['--rulebook', 'hexagonal', '--files', 'examples/**/*.ts', '--strict']);
    const fails = report.findings.filter((finding) => finding.severity === 'FAIL');
    expect(fails).toEqual([]);
    expect(code).toBe(0);
    expect(report.warnings).toEqual([]);
  });
});

describe('runCli', () => {
  it('never touches the network', () => {
    runJson(['--rulebook', 'hexagonal', '--files', 'examples/**/*.ts']);
    assertNetworkForbidden();
  });

  it('reports semantic and runtime classes as not implemented and skips them', () => {
    const { report, io } = runJson(['--rulebook', 'hexagonal', '--files', 'examples/**/*.ts', '--classes', 'static,semantic,runtime']);
    expect(report.skipped.semantic).toContain('hex/handler-no-business-rules');
    expect(report.skipped.runtime).toContain('hex/tests-coverage');
    expect(io.err.join('')).toContain('not implemented in this version');
  });

  it('exits 1 with --strict when a FAIL exists and 0 otherwise', () => {
    const glob = 'calibration/golden/hex/domain-no-nest-decorators/bad/**';
    expect(run(['--rulebook', 'hexagonal', '--files', glob]).code).toBe(0);
    expect(run(['--rulebook', 'hexagonal', '--files', glob, '--strict']).code).toBe(1);
  });

  it('prints text findings with path, line, severity, rule id and fix', () => {
    const { io } = run(['--rulebook', 'hexagonal', '--files', 'calibration/golden/hex/no-circular-import/bad/**', '--format', 'text']);
    const text = io.out.join('');
    expect(text).toMatch(/calibration\/golden\/hex\/no-circular-import\/bad\/\S+:\d+ FAIL hex\/no-circular-import/);
    expect(text).toContain('fix:');
    expect(text).toMatch(/\d+ FAIL/);
  });

  it('lists the rules applied per file with --explain', () => {
    const { report } = runJson(['--rulebook', 'hexagonal', '--files', 'examples/**/domain/entities/order.entity.ts', '--explain']);
    expect(report.explain?.['examples/order-bounded-context/domain/entities/order.entity.ts']).toContain('hex/domain-no-nest-decorators');
    expect(report.explain?.['examples/order-bounded-context/domain/entities/order.entity.ts']).toContain('hex/entity-unique-id');
  });

  it('resolves the project rulebook from flag, env or .claude/rulebook.yaml and composes extends', () => {
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

    const viaDefault = runJson(['--files', 'src/**/*.ts'], { CLAUDE_PROJECT_DIR: dir }, dir);
    expect(viaDefault.report.rulebook.id).toBe('acme');
    expect(viaDefault.report.uncalibrated).toBe(false);
    expect(viaDefault.report.findings).toHaveLength(1);
    expect(viaDefault.report.findings[0]).toMatchObject({ ruleId: 'hex/domain-no-nest-decorators', severity: 'WARN', line: 1 });

    writeFileSync(join(dir, 'other.yaml'), projectYaml.replace('id: acme', 'id: other'));
    const viaEnv = runJson(['--files', 'src/**/*.ts'], { NESTJS_HEXAGONAL_RULEBOOK: 'other.yaml' }, dir);
    expect(viaEnv.report.rulebook.id).toBe('other');
    const viaFlag = runJson(['--project-rulebook', 'other.yaml', '--files', 'src/**/*.ts'], {}, dir);
    expect(viaFlag.report.rulebook.id).toBe('other');
  });

  it('marks a stale extends stamp as uncalibrated with a warning and still runs', () => {
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
    const { report, code } = runJson(['--project-rulebook', 'rulebook.yaml', '--files', 'nothing/**'], {}, dir);
    expect(code).toBe(0);
    expect(report.uncalibrated).toBe(true);
    expect(report.warnings[0]).toMatch(/^rulebook-mismatch/);
  });

  it('fails with exit 2 and a message when no rulebook can be found or a flag is unknown', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hex-empty-'));
    const missing = run(['--files', 'src/**'], {}, dir);
    expect(missing.code).toBe(2);
    expect(missing.io.err.join('')).toContain('rulebook');
    const unknown = run(['--rulebook', 'hexagonal', '--files', 'x', '--bogus']);
    expect(unknown.code).toBe(2);
    const unknownId = run(['--rulebook', 'does-not-exist', '--files', 'x']);
    expect(unknownId.code).toBe(2);
  });

  it('uses git diff --name-only for --diff', () => {
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
    const { report } = runJson(['--rulebook', 'hexagonal', '--diff', 'HEAD~1'], {}, dir);
    expect(report.findings.map((finding) => finding.path)).toEqual(['bc/domain/dirty.ts']);
  });

  it('treats --hook as a no-op in this version', () => {
    const { code, io } = run(['--hook', 'pre-tool-use']);
    expect(code).toBe(0);
    expect(io.out.join('')).toBe('');
  });

  it('project.example stamps match the shipped base rulebooks', () => {
    const { report } = runJson(['--project-rulebook', 'rulebooks/project.example.rulebook.yaml', '--files', 'examples/**/*.ts']);
    expect(report.uncalibrated).toBe(false);
    expect(report.warnings).toEqual([]);
  });
});

describe('node fallback', () => {
  it('runs check.ts under node --experimental-strip-types', () => {
    const output = execFileSync(
      'node',
      ['--experimental-strip-types', '--no-warnings', join(PLUGIN_ROOT, 'scripts', 'check.ts'), '--rulebook', 'hexagonal', '--files', 'calibration/golden/hex/no-circular-import/bad/**', '--format', 'json'],
      { cwd: PLUGIN_ROOT, encoding: 'utf8' },
    );
    const parsed: unknown = JSON.parse(output);
    expect(isJsonReport(parsed) && parsed.findings.length > 0).toBe(true);
  });
});
