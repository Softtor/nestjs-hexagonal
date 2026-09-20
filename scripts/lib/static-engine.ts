import { isInScope, matchGlob } from './scope.ts';
import type { Check, Rule, Severity } from './rulebook.schema.ts';

export interface SourceFile {
  path: string;
  content: string;
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  path: string;
  line?: number;
  evidence: string;
  fix: string;
  class: 'static';
}

export type Executor = (rule: Rule, scopedFiles: SourceFile[], allFiles: SourceFile[]) => Finding[];

export interface StaticRunOptions {
  projectFiles?: () => SourceFile[];
}

export interface StaticRunResult {
  findings: Finding[];
  warnings: string[];
  applied: Record<string, string[]>;
}

const executors = new Map<string, Executor>();

export function registerExecutor(id: string, executor: Executor): void {
  executors.set(id, executor);
}

export function unregisterExecutor(id: string): void {
  executors.delete(id);
}

export function hasExecutor(id: string): boolean {
  return executors.has(id);
}

const EVIDENCE_MAX_LENGTH = 160;

export function lineAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i += 1) {
    if (content.charCodeAt(i) === 10) {
      line += 1;
    }
  }
  return line;
}

function lineText(content: string, index: number): string {
  const start = content.lastIndexOf('\n', index - 1) + 1;
  const endIndex = content.indexOf('\n', index);
  const end = endIndex === -1 ? content.length : endIndex;
  const text = content.slice(start, end).trim();
  return text.length > EVIDENCE_MAX_LENGTH ? `${text.slice(0, EVIDENCE_MAX_LENGTH)}...` : text;
}

export function maskCommentsAndStrings(source: string): string {
  const out: string[] = [];
  let i = 0;
  const length = source.length;
  const blank = (char: string): string => (char === '\n' ? '\n' : ' ');

  while (i < length) {
    const char = source[i];
    const next = source[i + 1];

    if (char === '/' && next === '/') {
      while (i < length && source[i] !== '\n') {
        out.push(' ');
        i += 1;
      }
      continue;
    }

    if (char === '/' && next === '*') {
      out.push(' ', ' ');
      i += 2;
      while (i < length && !(source[i] === '*' && source[i + 1] === '/')) {
        out.push(blank(source[i]));
        i += 1;
      }
      if (i < length) {
        out.push(' ', ' ');
        i += 2;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      const quote = char;
      out.push(quote);
      i += 1;
      while (i < length && source[i] !== quote) {
        if (source[i] === '\\' && i + 1 < length) {
          out.push(' ', blank(source[i + 1]));
          i += 2;
          continue;
        }
        if (quote !== '`' && source[i] === '\n') {
          break;
        }
        out.push(blank(source[i]));
        i += 1;
      }
      if (i < length && source[i] === quote) {
        out.push(quote);
        i += 1;
      }
      continue;
    }

    out.push(char);
    i += 1;
  }

  return out.join('');
}

export interface ImportEntry {
  specifier: string;
  line: number;
}

const IMPORT_PATTERN = /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?(['"])(?:\s*)\1/g;
const REQUIRE_PATTERN = /\brequire\s*\(\s*(['"])\s*\1\s*\)/g;

export function extractImports(source: string): ImportEntry[] {
  const masked = maskCommentsAndStrings(source);
  const entries: Array<ImportEntry & { index: number }> = [];

  for (const match of masked.matchAll(IMPORT_PATTERN)) {
    const openQuote = match[0].lastIndexOf(match[1], match[0].length - 2);
    const start = match.index + openQuote + 1;
    const end = match.index + match[0].length - 1;
    entries.push({ specifier: source.slice(start, end).trim(), line: lineAt(source, match.index), index: match.index });
  }

  for (const match of masked.matchAll(REQUIRE_PATTERN)) {
    const openQuote = match[0].indexOf(match[1]);
    const closeQuote = match[0].lastIndexOf(match[1]);
    const start = match.index + openQuote + 1;
    const end = match.index + closeQuote;
    entries.push({ specifier: source.slice(start, end).trim(), line: lineAt(source, match.index), index: match.index });
  }

  return entries.sort((a, b) => a.index - b.index).map(({ specifier, line }) => ({ specifier, line }));
}

function finding(rule: Rule, path: string, evidence: string, line?: number): Finding {
  const result: Finding = { ruleId: rule.id, severity: rule.severity, path, evidence, fix: rule.fix, class: 'static' };
  if (line !== undefined) {
    result.line = line;
  }
  return result;
}

function enclosingContains(content: string, index: number, pattern: string): boolean {
  const masked = maskCommentsAndStrings(content);
  const range = enclosingDeclaration(masked, index) ?? statementWindow(content, index);
  return new RegExp(pattern).test(content.slice(range.start, range.end + 1));
}

function runRegex(rule: Rule, check: Extract<Check, { kind: 'regex' }>, file: SourceFile): Finding[] {
  if (check.whenPattern !== undefined && !new RegExp(check.whenPattern).test(file.content)) {
    return [];
  }
  const flags = check.flags.includes('g') ? check.flags : `${check.flags}g`;
  const allMatches = [...file.content.matchAll(new RegExp(check.pattern, flags))];
  const matches = check.unlessInEnclosingDeclaration === undefined ? allMatches : allMatches.filter((match) => !enclosingContains(file.content, match.index, check.unlessInEnclosingDeclaration ?? ''));

  if (check.mustMatch) {
    return matches.length === 0 ? [finding(rule, file.path, `no match for /${check.pattern}/`)] : [];
  }

  if (check.maxMatches !== undefined) {
    if (matches.length <= check.maxMatches) {
      return [];
    }
    const overflow = matches[check.maxMatches];
    return [
      finding(
        rule,
        file.path,
        `${matches.length} matches of /${check.pattern}/ (max ${check.maxMatches})`,
        overflow ? lineAt(file.content, overflow.index) : undefined,
      ),
    ];
  }

  return matches.map((match) => finding(rule, file.path, lineText(file.content, match.index), lineAt(file.content, match.index)));
}

function runForbiddenImport(rule: Rule, check: Extract<Check, { kind: 'forbidden-import' }>, file: SourceFile): Finding[] {
  const findings: Finding[] = [];
  for (const entry of extractImports(file.content)) {
    const forbidden = check.modules.some((pattern) => matchGlob(pattern, entry.specifier));
    const allowed = check.allow.some((pattern) => matchGlob(pattern, entry.specifier));
    if (forbidden && !allowed) {
      findings.push(finding(rule, file.path, `imports '${entry.specifier}'`, entry.line));
    }
  }
  return findings;
}

function runRequiredImport(rule: Rule, check: Extract<Check, { kind: 'required-import' }>, file: SourceFile): Finding[] {
  if (check.whenPattern !== undefined && !new RegExp(check.whenPattern).test(file.content)) {
    return [];
  }
  const satisfied = extractImports(file.content).some((entry) =>
    check.modules.some((pattern) => matchGlob(pattern, entry.specifier)),
  );
  return satisfied ? [] : [finding(rule, file.path, `no import matching ${check.modules.join(', ')}`)];
}

function findBlockEnd(masked: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < masked.length; i += 1) {
    const char = masked[i];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return masked.length - 1;
}

const MODIFIERS = '(?:(?:public|private|protected|static|async|override|readonly|export|default)\\s+)*';
const BLOCK_KEYWORDS = '(?!(?:if|for|while|switch|catch|return|else|do|with|function)\\b)';
const RETURN_TYPE = '(?:[^{;=\\n]|\\{[^{}\\n]*\\})*\\{';

function declarationPatterns(selector: 'function' | 'method', name?: string): RegExp[] {
  const identifier = name ?? `${BLOCK_KEYWORDS}[A-Za-z_$][\\w$]*`;
  if (selector === 'method') {
    return [new RegExp(`^[ \\t]*${MODIFIERS}(?:async\\s+)?\\*?\\s*(?:${identifier})\\s*(?:<[^>]*>)?\\s*\\([^)]*\\)${RETURN_TYPE}`, 'gm')];
  }
  return [
    new RegExp(`^[ \\t]*${MODIFIERS}function\\s*\\*?\\s*(?:${identifier})\\s*(?:<[^>]*>)?\\s*\\([^)]*\\)${RETURN_TYPE}`, 'gm'),
    new RegExp(
      `^[ \\t]*${MODIFIERS}(?:const|let|var)\\s+(?:${identifier})\\s*(?::[^=]*)?=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*(?::[^=]*)?=>\\s*\\{`,
      'gm',
    ),
  ];
}

interface DeclarationRange {
  start: number;
  end: number;
}

function declarationRanges(masked: string): DeclarationRange[] {
  const ranges: DeclarationRange[] = [];
  const seen = new Set<number>();
  for (const pattern of [...declarationPatterns('method'), ...declarationPatterns('function')]) {
    for (const match of masked.matchAll(pattern)) {
      const openIndex = match.index + match[0].length - 1;
      if (seen.has(openIndex)) {
        continue;
      }
      seen.add(openIndex);
      ranges.push({ start: match.index, end: findBlockEnd(masked, openIndex) });
    }
  }
  return ranges;
}

export function enclosingDeclaration(masked: string, index: number): DeclarationRange | null {
  let best: DeclarationRange | null = null;
  for (const range of declarationRanges(masked)) {
    if (index < range.start || index > range.end) {
      continue;
    }
    if (best === null || range.end - range.start < best.end - best.start) {
      best = range;
    }
  }
  return best;
}

function statementWindow(content: string, index: number): DeclarationRange {
  const end = content.indexOf(';', index);
  return { start: index, end: end === -1 ? content.length : end };
}

function runLineCount(rule: Rule, check: Extract<Check, { kind: 'line-count' }>, file: SourceFile): Finding[] {
  if (check.selector === 'file') {
    const lines = file.content.split('\n').length;
    return lines > check.max ? [finding(rule, file.path, `file spans ${lines} lines (max ${check.max})`, 1)] : [];
  }

  const masked = maskCommentsAndStrings(file.content);
  const findings: Finding[] = [];
  const seen = new Set<number>();
  for (const pattern of declarationPatterns(check.selector, check.name)) {
    for (const match of masked.matchAll(pattern)) {
      const openIndex = match.index + match[0].length - 1;
      if (seen.has(openIndex)) {
        continue;
      }
      seen.add(openIndex);
      const closeIndex = findBlockEnd(masked, openIndex);
      const startLine = lineAt(file.content, match.index);
      const endLine = lineAt(file.content, closeIndex);
      const span = endLine - startLine + 1;
      if (span > check.max) {
        const label = match[0].trim().split('(')[0]?.trim() ?? check.selector;
        findings.push(finding(rule, file.path, `${label} spans ${span} lines (max ${check.max})`, startLine));
      }
    }
  }
  return findings.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
}

export function runCheckOnFile(rule: Rule, check: Check, file: SourceFile): Finding[] {
  switch (check.kind) {
    case 'regex':
      return runRegex(rule, check, file);
    case 'forbidden-import':
      return runForbiddenImport(rule, check, file);
    case 'required-import':
      return runRequiredImport(rule, check, file);
    case 'line-count':
      return runLineCount(rule, check, file);
    case 'external':
      return [];
  }
}

export function runStaticRules(rules: Rule[], files: SourceFile[], options: StaticRunOptions = {}): StaticRunResult {
  const findings: Finding[] = [];
  const warnings: string[] = [];
  const applied: Record<string, string[]> = {};
  let projectFiles: SourceFile[] | null = null;
  const resolveProjectFiles = (): SourceFile[] => {
    if (projectFiles === null) {
      projectFiles = options.projectFiles ? options.projectFiles() : files;
    }
    return projectFiles;
  };

  for (const rule of rules) {
    if (rule.class !== 'static' || !rule.check) {
      continue;
    }
    const scoped = files.filter((file) => isInScope(rule.scope, file.path));
    if (scoped.length === 0) {
      continue;
    }
    for (const file of scoped) {
      (applied[file.path] ??= []).push(rule.id);
    }

    if (rule.check.kind === 'external') {
      const executor = executors.get(rule.check.executorId);
      if (!executor) {
        warnings.push(`rule ${rule.id}: external executor '${rule.check.executorId}' is not registered; skipped`);
        continue;
      }
      findings.push(...executor(rule, scoped, resolveProjectFiles()));
      continue;
    }

    for (const file of scoped) {
      findings.push(...runCheckOnFile(rule, rule.check, file));
    }
  }

  return { findings, warnings, applied };
}
