import './helpers/no-network.ts';
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { composeRulebook, loadComposedRulebook, RulebookCompositionError, semanticRulebookVersion, type BaseResolver } from '../lib/compose.ts';
import { parseRulebook, type Rulebook } from '../lib/rulebook.schema.ts';

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function rule(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: id,
    layer: 'domain',
    scope: { include: ['**/domain/**'], exclude: ['**/__tests__/**'] },
    class: 'static',
    severity: 'FAIL',
    rationale: 'r',
    fix: 'f',
    check: { kind: 'regex', pattern: 'x' },
    ...overrides,
  };
}

function book(id: string, rules: unknown[], extra: Record<string, unknown> = {}): Rulebook {
  const parsed = parseRulebook({
    $schema: 'nestjs-hexagonal/rulebook@1',
    id,
    version: '1.0.0',
    model: { provider: 'typesafe', pin: 'jev-1.13.0' },
    rules,
    ...extra,
  });
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.rulebook;
}

const baseText = stringify({ id: 'base' });
const base = book('base', [rule('hex/a'), rule('hex/b', { severity: 'WARN' })]);

function resolver(entries: Record<string, { rulebook: Rulebook; text: string }>): BaseResolver {
  return (id) => {
    const entry = entries[id];
    if (!entry) {
      return null;
    }
    return { rulebook: entry.rulebook, sha256: sha256(entry.text), path: `${id}.rulebook.yaml` };
  };
}

describe('composeRulebook', () => {
  it('returns base rules plus project rules when the stamp matches', () => {
    const project = book('proj', [rule('proj/c')], {
      extends: [{ id: 'base', version: '1.0.0', sha256: sha256(baseText) }],
    });
    const composed = composeRulebook(project, resolver({ base: { rulebook: base, text: baseText } }));
    expect(composed.rules.map((r) => r.id)).toEqual(['hex/a', 'hex/b', 'proj/c']);
    expect(composed.uncalibrated).toBe(false);
    expect(composed.warnings).toEqual([]);
    expect(composed.sources['hex/a']).toBe('base');
    expect(composed.sources['proj/c']).toBe('proj');
  });

  it('marks the composition uncalibrated on sha mismatch without throwing', () => {
    const project = book('proj', [], { extends: [{ id: 'base', version: '0.9.0', sha256: 'a'.repeat(64) }] });
    const composed = composeRulebook(project, resolver({ base: { rulebook: base, text: baseText } }));
    expect(composed.uncalibrated).toBe(true);
    expect(composed.warnings).toHaveLength(1);
    expect(composed.warnings[0]).toMatch(/^rulebook-mismatch/);
    expect(composed.warnings[0]).toContain('0.9.0@aaaaaaaa');
    expect(composed.warnings[0]).toContain(`1.0.0@${sha256(baseText).slice(0, 8)}`);
    expect(composed.rules).toHaveLength(2);
  });

  it('throws on a rule id collision with a base', () => {
    const project = book('proj', [rule('hex/a')], {
      extends: [{ id: 'base', version: '1.0.0', sha256: sha256(baseText) }],
    });
    expect(() => composeRulebook(project, resolver({ base: { rulebook: base, text: baseText } }))).toThrow(
      RulebookCompositionError,
    );
  });

  it('throws when a base cannot be resolved or extends cycles', () => {
    const project = book('proj', [], { extends: [{ id: 'ghost', version: '1', sha256: 'a'.repeat(64) }] });
    expect(() => composeRulebook(project, resolver({}))).toThrow(/ghost/);

    const loopText = 'loop';
    const loop = book('loop', [], { extends: [{ id: 'loop', version: '1', sha256: sha256(loopText) }] });
    expect(() => composeRulebook(loop, resolver({ loop: { rulebook: loop, text: loopText } }))).toThrow(/cycle/);
  });

  it('resolves extends recursively', () => {
    const midText = 'mid';
    const mid = book('mid', [rule('mid/m')], { extends: [{ id: 'base', version: '1.0.0', sha256: sha256(baseText) }] });
    const project = book('proj', [], { extends: [{ id: 'mid', version: '1.0.0', sha256: sha256(midText) }] });
    const composed = composeRulebook(
      project,
      resolver({ base: { rulebook: base, text: baseText }, mid: { rulebook: mid, text: midText } }),
    );
    expect(composed.rules.map((r) => r.id)).toEqual(['hex/a', 'hex/b', 'mid/m']);
  });

  it('deduplicates a base reached twice through a diamond instead of colliding', () => {
    const dText = 'd';
    const d = book('d', [rule('d/x')]);
    const bText = 'b';
    const b = book('b', [rule('b/y')], { extends: [{ id: 'd', version: '1.0.0', sha256: sha256(dText) }] });
    const cText = 'c';
    const c = book('c', [rule('c/z')], { extends: [{ id: 'd', version: '1.0.0', sha256: sha256(dText) }] });
    const a = book('a', [], {
      extends: [
        { id: 'b', version: '1.0.0', sha256: sha256(bText) },
        { id: 'c', version: '1.0.0', sha256: sha256(cText) },
      ],
    });
    const composed = composeRulebook(a, resolver({ b: { rulebook: b, text: bText }, c: { rulebook: c, text: cText }, d: { rulebook: d, text: dText } }));
    expect(composed.rules.map((r) => r.id)).toEqual(['d/x', 'b/y', 'c/z']);
    expect(composed.uncalibrated).toBe(false);
  });

  it('applies overrides: disabled, severity, scope merge, thresholds field-merge', () => {
    const semanticBase = book('sem', [
      rule('hex/s', {
        class: 'semantic',
        check: undefined,
        question: { type: 'noul', instructions: 'q' },
        state: { slice: 'file' },
        thresholds: { ask: 0.75, advise: 0.55, uncertain: { lo: 0.35, hi: 0.65 } },
      }),
      rule('hex/a'),
      rule('hex/b'),
    ]);
    const semText = 'sem';
    const project = book('proj', [], {
      extends: [{ id: 'sem', version: '1.0.0', sha256: sha256(semText) }],
      overrides: [
        { id: 'hex/a', disabled: true },
        { id: 'hex/b', severity: 'WARN', scope: { include: ['src/**'], exclude: ['legacy/**'] } },
        { id: 'hex/s', thresholds: { uncertain: { hi: 0.7 }, ask: 0.8 } },
      ],
    });
    const composed = composeRulebook(project, resolver({ sem: { rulebook: semanticBase, text: semText } }));
    const ids = composed.rules.map((r) => r.id);
    expect(ids).not.toContain('hex/a');
    const b = composed.rules.find((r) => r.id === 'hex/b');
    expect(b?.severity).toBe('WARN');
    expect(b?.scope).toEqual({ include: ['src/**'], exclude: ['**/__tests__/**', 'legacy/**'] });
    const s = composed.rules.find((r) => r.id === 'hex/s');
    expect(s?.thresholds).toEqual({ ask: 0.8, advise: 0.55, uncertain: { lo: 0.35, hi: 0.7 } });
  });

  it('rejects an override for an unknown rule id or a mismatched threshold shape', () => {
    const project = book('proj', [], {
      extends: [{ id: 'base', version: '1.0.0', sha256: sha256(baseText) }],
      overrides: [{ id: 'hex/zzz', disabled: true }],
    });
    expect(() => composeRulebook(project, resolver({ base: { rulebook: base, text: baseText } }))).toThrow(/hex\/zzz/);

    const semText = 'sem';
    const semanticBase = book('sem', [
      rule('hex/s', {
        class: 'semantic',
        check: undefined,
        question: { type: 'noul', instructions: 'q' },
        state: { slice: 'file' },
        thresholds: { advise: 0.55, uncertain: { lo: 0.35, hi: 0.65 } },
      }),
    ]);
    const bad = book('proj', [], {
      extends: [{ id: 'sem', version: '1.0.0', sha256: sha256(semText) }],
      overrides: [{ id: 'hex/s', thresholds: { minConfidence: 0.6 } }],
    });
    expect(() => composeRulebook(bad, resolver({ sem: { rulebook: semanticBase, text: semText } }))).toThrow(
      /minConfidence/,
    );
  });

  it('applies a check override to a regex rule and rejects it on any other check kind', () => {
    const mixed = book('mixed', [
      rule('hex/r', { check: { kind: 'regex', pattern: 'find', unlessInEnclosingDeclaration: 'organizationId' } }),
      rule('hex/i', { check: { kind: 'forbidden-import', modules: ['@nestjs/*'] } }),
    ]);
    const mixedText = 'mixed';
    const ok = book('proj', [], {
      extends: [{ id: 'mixed', version: '1.0.0', sha256: sha256(mixedText) }],
      overrides: [{ id: 'hex/r', check: { unlessInEnclosingDeclaration: 'organizationId|conversationId' } }],
    });
    const composed = composeRulebook(ok, resolver({ mixed: { rulebook: mixed, text: mixedText } }));
    expect(composed.rules.find((r) => r.id === 'hex/r')?.check).toEqual({
      kind: 'regex',
      pattern: 'find',
      flags: '',
      mustMatch: false,
      unlessInEnclosingDeclaration: 'organizationId|conversationId',
    });

    const bad = book('proj', [], {
      extends: [{ id: 'mixed', version: '1.0.0', sha256: sha256(mixedText) }],
      overrides: [{ id: 'hex/i', check: { unlessInEnclosingDeclaration: 'x' } }],
    });
    expect(() => composeRulebook(bad, resolver({ mixed: { rulebook: mixed, text: mixedText } }))).toThrow(
      /hex\/i.*regex checks/,
    );
  });
});

describe('loadComposedRulebook', () => {
  it('loads YAML from disk and resolves extends against a rulebooks directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rulebook-'));
    const rulebooksDir = join(dir, 'rulebooks');
    mkdirSync(rulebooksDir);
    const baseYaml = stringify({
      $schema: 'nestjs-hexagonal/rulebook@1',
      id: 'base',
      version: '1.0.0',
      model: { provider: 'typesafe', pin: 'jev-1.13.0' },
      rules: [rule('hex/a')],
    });
    writeFileSync(join(rulebooksDir, 'base.rulebook.yaml'), baseYaml);
    const projectPath = join(dir, 'rulebook.yaml');
    writeFileSync(
      projectPath,
      stringify({
        $schema: 'nestjs-hexagonal/rulebook@1',
        id: 'proj',
        version: '0.1.0',
        extends: [{ id: 'base', version: '1.0.0', sha256: sha256(baseYaml) }],
        model: { provider: 'typesafe', pin: 'jev-1.13.0' },
        rules: [rule('proj/x')],
      }),
    );
    const composed = loadComposedRulebook(projectPath, rulebooksDir);
    expect(composed.rules.map((r) => r.id)).toEqual(['hex/a', 'proj/x']);
    expect(composed.uncalibrated).toBe(false);
    expect(composed.rulebook.id).toBe('proj');
  });

  it('exposes the version of every composed rulebook', () => {
    const project = book('proj', [rule('proj/c')], { version: '0.1.0', extends: [{ id: 'base', version: '1.0.0', sha256: sha256(baseText) }] });
    const composed = composeRulebook(project, resolver({ base: { rulebook: base, text: baseText } }));
    expect(composed.versions).toEqual({ proj: '0.1.0', base: '1.0.0' });
  });

  it('reports schema errors with the file path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rulebook-'));
    const path = join(dir, 'broken.yaml');
    writeFileSync(path, stringify({ id: 'x' }));
    expect(() => loadComposedRulebook(path, dir)).toThrow(/broken\.yaml/);
  });
});

describe('semanticRulebookVersion', () => {
  const semantic = (id: string) =>
    rule(id, {
      class: 'semantic',
      question: { type: 'noul', instructions: 'q' },
      state: { slice: 'file' },
      check: undefined,
    });
  const semanticBase = book('base', [semantic('hex/s')]);

  it('is the base version when every semantic rule comes from that base', () => {
    const project = book('proj', [rule('proj/c')], { version: '0.1.0', extends: [{ id: 'base', version: '1.0.0', sha256: sha256(baseText) }] });
    const composed = composeRulebook(project, resolver({ base: { rulebook: semanticBase, text: baseText } }));
    expect(semanticRulebookVersion(composed)).toBe('1.0.0');
  });

  it('is the project version when semantic rules come from more than one rulebook, or from none', () => {
    const mixed = book('proj', [semantic('proj/s')], { version: '0.1.0', extends: [{ id: 'base', version: '1.0.0', sha256: sha256(baseText) }] });
    expect(semanticRulebookVersion(composeRulebook(mixed, resolver({ base: { rulebook: semanticBase, text: baseText } })))).toBe('0.1.0');
    const none = book('proj', [rule('proj/c')], { version: '0.2.0' });
    expect(semanticRulebookVersion(composeRulebook(none, resolver({})))).toBe('0.2.0');
  });
});
