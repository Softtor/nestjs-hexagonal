import './helpers/no-network.ts';
import { describe, expect, it } from 'bun:test';
import { globToRegExp, matchGlob, isInScope } from '../lib/scope.ts';

describe('matchGlob', () => {
  it('matches literal paths', () => {
    expect(matchGlob('src/a.ts', 'src/a.ts')).toBe(true);
    expect(matchGlob('src/a.ts', 'src/b.ts')).toBe(false);
  });

  it('* does not cross a slash', () => {
    expect(matchGlob('src/*.ts', 'src/a.ts')).toBe(true);
    expect(matchGlob('src/*.ts', 'src/x/a.ts')).toBe(false);
  });

  it('? matches a single character that is not a slash', () => {
    expect(matchGlob('a?.ts', 'ab.ts')).toBe(true);
    expect(matchGlob('a?.ts', 'a/.ts')).toBe(false);
    expect(matchGlob('a?.ts', 'abc.ts')).toBe(false);
  });

  it('** matches zero or more directories at the start, middle and end', () => {
    expect(matchGlob('**/domain/**', 'domain/x.ts')).toBe(true);
    expect(matchGlob('**/domain/**', 'src/bc/domain/entities/x.ts')).toBe(true);
    expect(matchGlob('**/domain/**', 'src/bc/application/x.ts')).toBe(false);
    expect(matchGlob('a/**/b', 'a/b')).toBe(true);
    expect(matchGlob('a/**/b', 'a/x/y/b')).toBe(true);
    expect(matchGlob('**/*.spec.ts', 'x.spec.ts')).toBe(true);
    expect(matchGlob('**/*.spec.ts', 'a/b/x.spec.ts')).toBe(true);
  });

  it('** inside a segment matches across slashes', () => {
    expect(matchGlob('**/*data-builder*', '../../testing/helpers/order.data-builder')).toBe(true);
    expect(matchGlob('**/testing/helpers/**', '../../testing/helpers/order.data-builder')).toBe(true);
  });

  it('{a,b} alternation', () => {
    expect(matchGlob('src/**/*.{ts,tsx}', 'src/a/b.tsx')).toBe(true);
    expect(matchGlob('src/**/*.{ts,tsx}', 'src/a/b.js')).toBe(false);
    expect(matchGlob('@nestjs/{common,core}', '@nestjs/core')).toBe(true);
  });

  it('matches module specifiers with a glob', () => {
    expect(matchGlob('@nestjs/*', '@nestjs/common')).toBe(true);
    expect(matchGlob('@nestjs/*', '@nestjs/cqrs')).toBe(true);
    expect(matchGlob('@nestjs/*', 'class-validator')).toBe(false);
  });

  it('escapes regex metacharacters', () => {
    expect(matchGlob('a.b', 'axb')).toBe(false);
    expect(matchGlob('a+b', 'a+b')).toBe(true);
    expect(globToRegExp('a.b').source).toContain('\\.');
  });

  it('normalizes windows separators and leading ./', () => {
    expect(matchGlob('src/*.ts', 'src\\a.ts')).toBe(true);
    expect(matchGlob('src/*.ts', './src/a.ts')).toBe(true);
  });
});

describe('isInScope', () => {
  const scope = { include: ['**/domain/**/*.ts'], exclude: ['**/__tests__/**'] };

  it('requires an include match and no exclude match', () => {
    expect(isInScope(scope, 'bc/domain/x.ts')).toBe(true);
    expect(isInScope(scope, 'bc/domain/__tests__/x.spec.ts')).toBe(false);
    expect(isInScope(scope, 'bc/application/x.ts')).toBe(false);
  });
});
