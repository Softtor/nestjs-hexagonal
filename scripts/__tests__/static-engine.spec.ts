import './helpers/no-network.ts';
import { describe, expect, it } from 'bun:test';
import { RuleSchema, type Rule } from '../lib/rulebook.schema.ts';
import {
  extractImports,
  maskCommentsAndStrings,
  registerExecutor,
  runStaticRules,
  unregisterExecutor,
  type SourceFile,
} from '../lib/static-engine.ts';

function makeRule(overrides: Record<string, unknown>): Rule {
  return RuleSchema.parse({
    id: 'test/rule',
    title: 'test',
    layer: 'any',
    scope: { include: ['**/*.ts'] },
    class: 'static',
    severity: 'FAIL',
    rationale: 'because',
    fix: 'do it',
    check: { kind: 'regex', pattern: 'x' },
    ...overrides,
  });
}

function file(path: string, content: string): SourceFile {
  return { path, content };
}

describe('maskCommentsAndStrings', () => {
  it('blanks comments and string contents while preserving length and newlines', () => {
    const source = "const a = 'x{'; // {\n/* } */ const b = `t${1}`;";
    const masked = maskCommentsAndStrings(source);
    expect(masked.length).toBe(source.length);
    expect(masked.split('\n').length).toBe(2);
    expect(masked).not.toContain('{');
    expect(masked).toContain('const a =');
  });
});

describe('extractImports', () => {
  it('finds single-line, multi-line, type, side-effect, re-export and require specifiers', () => {
    const source = [
      "import { A } from '@nestjs/common';",
      'import {',
      '  B,',
      "} from './b';",
      "import type { C } from '../c';",
      "import './side-effect';",
      "export * from './re';",
      "export { D } from './d';",
      "const e = require('e');",
      "// import { Ghost } from './ghost';",
      "const text = 'from \"not-an-import\"';",
    ].join('\n');
    const imports = extractImports(source);
    expect(imports.map((entry) => entry.specifier)).toEqual([
      '@nestjs/common',
      './b',
      '../c',
      './side-effect',
      './re',
      './d',
      'e',
    ]);
    expect(imports[1]?.line).toBe(2);
  });
});

describe('regex check', () => {
  it('reports each match with its line number', () => {
    const rule = makeRule({ check: { kind: 'regex', pattern: 'forwardRef\\s*\\(' } });
    const result = runStaticRules([rule], [file('a.module.ts', 'imports: [\n  forwardRef(() => B),\n  forwardRef(() => C),\n]')]);
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0]).toMatchObject({ ruleId: 'test/rule', severity: 'FAIL', path: 'a.module.ts', line: 2, class: 'static', fix: 'do it' });
    expect(result.findings[0]?.evidence).toContain('forwardRef');
    expect(result.findings[1]?.line).toBe(3);
  });

  it('honours flags, mustMatch and maxMatches', () => {
    const mustMatch = makeRule({ check: { kind: 'regex', pattern: 'extends Entity<', mustMatch: true } });
    expect(runStaticRules([mustMatch], [file('x.entity.ts', 'export class X {}')]).findings).toHaveLength(1);
    expect(runStaticRules([mustMatch], [file('x.entity.ts', 'export class X extends Entity<P> {}')]).findings).toHaveLength(0);

    const insensitive = makeRule({ check: { kind: 'regex', pattern: 'todo', flags: 'i' } });
    expect(runStaticRules([insensitive], [file('a.ts', 'TODO')]).findings).toHaveLength(1);

    const capped = makeRule({ check: { kind: 'regex', pattern: 'x', maxMatches: 2 } });
    expect(runStaticRules([capped], [file('a.ts', 'x x')]).findings).toHaveLength(0);
    const over = runStaticRules([capped], [file('a.ts', 'x\nx\nx')]);
    expect(over.findings).toHaveLength(1);
    expect(over.findings[0]?.evidence).toContain('3');
    expect(over.findings[0]?.line).toBe(3);
  });

  it('only applies when whenPattern matches', () => {
    const rule = makeRule({ check: { kind: 'regex', pattern: 'this\\.repo\\.find', whenPattern: '@EventsHandler\\(' } });
    const plain = file('h.ts', 'class H { handle() { this.repo.find(); } }');
    const handler = file('h.ts', '@EventsHandler(E)\nclass H { handle() { this.repo.find(); } }');
    expect(runStaticRules([rule], [plain]).findings).toHaveLength(0);
    expect(runStaticRules([rule], [handler]).findings).toHaveLength(1);
  });

  it('respects the rule scope', () => {
    const rule = makeRule({ scope: { include: ['**/domain/**'], exclude: ['**/__tests__/**'] }, check: { kind: 'regex', pattern: 'x' } });
    const result = runStaticRules([rule], [file('bc/domain/a.ts', 'x'), file('bc/domain/__tests__/a.spec.ts', 'x'), file('bc/app/a.ts', 'x')]);
    expect(result.findings.map((finding) => finding.path)).toEqual(['bc/domain/a.ts']);
    expect(result.applied['bc/domain/a.ts']).toEqual(['test/rule']);
    expect(result.applied['bc/app/a.ts']).toBeUndefined();
  });
});

describe('forbidden-import check', () => {
  const rule = makeRule({ check: { kind: 'forbidden-import', modules: ['@nestjs/*', '**/infrastructure/**'], allow: ['@nestjs/cqrs'] } });

  it('flags matching specifiers unless allowed', () => {
    const source = "import { Injectable } from '@nestjs/common';\nimport { IEvent } from '@nestjs/cqrs';\nimport { X } from '../infrastructure/x';\n";
    const result = runStaticRules([rule], [file('d.ts', source)]);
    expect(result.findings.map((finding) => finding.line)).toEqual([1, 3]);
    expect(result.findings[0]?.evidence).toContain('@nestjs/common');
  });

  it('ignores commented imports', () => {
    expect(runStaticRules([rule], [file('d.ts', "// import { X } from '@nestjs/common';")]).findings).toHaveLength(0);
  });
});

describe('required-import check', () => {
  const rule = makeRule({ check: { kind: 'required-import', modules: ['**/*data-builder*'], whenPattern: 'Entity\\.create\\(' } });

  it('flags files that trigger whenPattern without the import', () => {
    const missing = file('a.spec.ts', 'const e = OrderEntity.create({});');
    const present = file('b.spec.ts', "import { OrderDataBuilder } from '../../testing/helpers/order.data-builder';\nconst e = OrderEntity.create(OrderDataBuilder());");
    const untriggered = file('c.spec.ts', 'expect(1).toBe(1);');
    const result = runStaticRules([rule], [missing, present, untriggered]);
    expect(result.findings.map((finding) => finding.path)).toEqual(['a.spec.ts']);
    expect(result.findings[0]?.line).toBeUndefined();
  });
});

describe('line-count check', () => {
  const handler = [
    'export class H {',
    '  constructor(private readonly repo: Repo) {}',
    '',
    '  async execute(cmd: Cmd): Promise<void> {',
    '    const a = 1;',
    "    const s = '}';",
    '    if (a) {',
    '      // }',
    '    }',
    '  }',
    '',
    '  private helper(): void {}',
    '}',
  ].join('\n');

  it('counts the lines of a named method including braces in strings and comments', () => {
    const ok = makeRule({ check: { kind: 'line-count', selector: 'method', name: 'execute', max: 7 } });
    expect(runStaticRules([ok], [file('h.ts', handler)]).findings).toHaveLength(0);
    const tight = makeRule({ check: { kind: 'line-count', selector: 'method', name: 'execute', max: 6 } });
    const result = runStaticRules([tight], [file('h.ts', handler)]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.line).toBe(4);
    expect(result.findings[0]?.evidence).toContain('7 lines');
  });

  it('counts a method whose return type contains braces', () => {
    const rule = makeRule({ check: { kind: 'line-count', selector: 'method', name: 'execute', max: 3 } });
    const source = 'class H {\n  async execute(command: C): Promise<{ id: string }> {\n    a();\n    b();\n    c();\n  }\n}';
    const result = runStaticRules([rule], [file('h.ts', source)]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.line).toBe(2);
    expect(result.findings[0]?.evidence).toContain('5 lines');
  });

  it('does not treat a call as a declaration', () => {
    const rule = makeRule({ check: { kind: 'line-count', selector: 'method', name: 'execute', max: 1 } });
    expect(runStaticRules([rule], [file('c.ts', 'await this.handler.execute(\n cmd,\n);')]).findings).toHaveLength(0);
  });

  it('counts functions and arrow functions and whole files', () => {
    const fn = makeRule({ check: { kind: 'line-count', selector: 'function', max: 3 } });
    const source = 'export function big() {\n  a();\n  b();\n}\nconst small = () => {\n  a();\n};\nexport const arrow = async (x: number): Promise<void> => {\n  a();\n  b();\n};';
    const result = runStaticRules([fn], [file('f.ts', source)]);
    expect(result.findings.map((finding) => finding.line)).toEqual([1, 8]);

    const whole = makeRule({ check: { kind: 'line-count', selector: 'file', max: 2 } });
    expect(runStaticRules([whole], [file('f.ts', 'a\nb\nc')]).findings).toHaveLength(1);
    expect(runStaticRules([whole], [file('f.ts', 'a\nb')]).findings).toHaveLength(0);
  });
});

describe('external check', () => {
  it('skips with a warning when the executor is not registered', () => {
    const rule = makeRule({ check: { kind: 'external', executorId: 'test/unregistered' } });
    const result = runStaticRules([rule], [file('a.ts', 'x')]);
    expect(result.findings).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('test/unregistered');
  });

  it('passes scoped and all files to a registered executor', () => {
    const rule = makeRule({ scope: { include: ['**/application/**'] }, check: { kind: 'external', executorId: 'test/registered' } });
    const seen: { scoped: string[]; all: string[] } = { scoped: [], all: [] };
    registerExecutor('test/registered', (targetRule, scoped, all) => {
      seen.scoped = scoped.map((entry) => entry.path);
      seen.all = all.map((entry) => entry.path);
      return [{ ruleId: targetRule.id, severity: targetRule.severity, path: 'bc/application', evidence: 'mixed', fix: targetRule.fix, class: 'static' }];
    });
    try {
      const result = runStaticRules([rule], [file('bc/application/a.ts', ''), file('bc/domain/b.ts', '')]);
      expect(seen).toEqual({ scoped: ['bc/application/a.ts'], all: ['bc/application/a.ts', 'bc/domain/b.ts'] });
      expect(result.findings).toHaveLength(1);
      expect(result.warnings).toHaveLength(0);
    } finally {
      unregisterExecutor('test/registered');
    }
  });
});

describe('runStaticRules', () => {
  it('ignores non-static rules', () => {
    const semantic = makeRule({
      class: 'semantic',
      check: undefined,
      question: { type: 'noul', instructions: 'q' },
      state: { slice: 'file' },
    });
    expect(runStaticRules([semantic], [file('a.ts', 'x')]).findings).toHaveLength(0);
  });
});
