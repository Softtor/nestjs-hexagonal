import type { Rule } from './rulebook.schema.ts';
import { enclosingDeclaration, findBlockEnd, lineAt, maskCommentsAndStrings, type DeclarationRange, type SourceFile } from './static-engine.ts';

export type Slice = 'file' | 'diff-window' | 'declaration' | 'exports-only' | 'strings-only' | 'jsx-only';

export interface Hunk {
  start: number;
  end: number;
}

export type JevState = {
  preamble: string;
  path: string;
  layer: string;
  slice: Slice;
  code: string;
};

export interface BuiltState {
  state: JevState;
  startLine: number;
  truncated: boolean;
}

export interface SlicedCode {
  code: string;
  startLine: number;
}

const GAP_MARKER = '// ...';
const CHARS_PER_TOKEN = 4;

interface LineRange {
  start: number;
  end: number;
}

function mergeRanges(ranges: LineRange[]): LineRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: LineRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end + 1) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function joinRanges(content: string, ranges: LineRange[]): SlicedCode {
  const lines = content.split('\n');
  const merged = mergeRanges(ranges.map((range) => ({ start: Math.max(1, range.start), end: Math.min(lines.length, range.end) })));
  const parts = merged.map((range) => lines.slice(range.start - 1, range.end).join('\n'));
  return { code: parts.join(`\n${GAP_MARKER}\n`), startLine: merged[0]?.start ?? 1 };
}

function windows(hunks: Hunk[], contextLines: number): LineRange[] {
  return hunks.map((hunk) => ({ start: hunk.start - contextLines, end: hunk.end + contextLines }));
}

function lineStartIndex(content: string, line: number): number {
  let index = 0;
  for (let current = 1; current < line; current += 1) {
    const next = content.indexOf('\n', index);
    if (next === -1) {
      return content.length;
    }
    index = next + 1;
  }
  return index;
}

const CLASS_PATTERN = /^[ \t]*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+[A-Za-z_$][\w$]*[^{;\n]*\{/gm;

function classRanges(masked: string): DeclarationRange[] {
  const ranges: DeclarationRange[] = [];
  for (const match of masked.matchAll(CLASS_PATTERN)) {
    const openIndex = match.index + match[0].length - 1;
    ranges.push({ start: match.index, end: findBlockEnd(masked, openIndex) });
  }
  return ranges;
}

function enclosingClass(masked: string, index: number): DeclarationRange | null {
  let best: DeclarationRange | null = null;
  for (const range of classRanges(masked)) {
    if (index < range.start || index > range.end) {
      continue;
    }
    if (best === null || range.end - range.start < best.end - best.start) {
      best = range;
    }
  }
  return best;
}

function toLineRange(content: string, range: DeclarationRange): LineRange {
  return { start: lineAt(content, range.start), end: lineAt(content, range.end) };
}

function declarationSlice(content: string, hunks: Hunk[], contextLines: number): SlicedCode {
  const masked = maskCommentsAndStrings(content);
  const ranges: LineRange[] = [];
  for (const hunk of hunks) {
    let covered = false;
    for (const line of [hunk.start, hunk.end]) {
      const index = lineStartIndex(content, line);
      const declaration = enclosingDeclaration(masked, index) ?? enclosingClass(masked, index);
      if (declaration) {
        ranges.push(toLineRange(content, declaration));
        covered = true;
      }
    }
    if (!covered) {
      ranges.push({ start: hunk.start - contextLines, end: hunk.end + contextLines });
    }
  }
  return joinRanges(content, ranges);
}

const EXPORT_PATTERN = /^[ \t]*export\b/gm;

function exportsSlice(content: string): SlicedCode {
  const masked = maskCommentsAndStrings(content);
  const ranges: LineRange[] = [];
  for (const match of masked.matchAll(EXPORT_PATTERN)) {
    const start = match.index;
    let end = start;
    let depth = 0;
    let index = start;
    while (index < masked.length) {
      const char = masked[index];
      if (char === '{') {
        end = findBlockEnd(masked, index);
        if (depth === 0) {
          const semicolon = masked.indexOf(';', end);
          const newline = masked.indexOf('\n', end);
          end = semicolon !== -1 && (newline === -1 || semicolon < newline) ? semicolon : end;
          break;
        }
        depth += 1;
        index = end + 1;
        continue;
      }
      if (char === ';' || char === '\n') {
        end = index;
        break;
      }
      index += 1;
      end = index;
    }
    ranges.push({ start: lineAt(content, start), end: lineAt(content, Math.min(end, content.length - 1)) });
  }
  if (ranges.length === 0) {
    return { code: '', startLine: 1 };
  }
  return joinRanges(content, ranges);
}

export function extractStrings(content: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < content.length) {
    const char = content[i];
    const next = content[i + 1];
    if (char === '/' && next === '/') {
      const end = content.indexOf('\n', i);
      i = end === -1 ? content.length : end;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = content.indexOf('*/', i + 2);
      i = end === -1 ? content.length : end + 2;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      const quote = char;
      let j = i + 1;
      let literal = '';
      while (j < content.length && content[j] !== quote) {
        if (content[j] === '\\' && j + 1 < content.length) {
          literal += content[j + 1];
          j += 2;
          continue;
        }
        if (quote !== '`' && content[j] === '\n') {
          break;
        }
        literal += content[j];
        j += 1;
      }
      out.push(literal);
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return out;
}

const JSX_LINE = /<\/?[A-Za-z][\w.:-]*(?:\s[^>]*)?\/?>|\/>/;

function jsxSlice(content: string): SlicedCode {
  const lines = content.split('\n');
  const ranges: LineRange[] = [];
  lines.forEach((line, index) => {
    if (JSX_LINE.test(line)) {
      ranges.push({ start: index + 1, end: index + 1 });
    }
  });
  if (ranges.length === 0) {
    return { code: '', startLine: 1 };
  }
  return joinRanges(content, ranges);
}

export function sliceCode(content: string, slice: Slice, hunks: Hunk[] | undefined, contextLines: number): SlicedCode {
  const changed = hunks ?? [];
  switch (slice) {
    case 'file':
      return { code: content, startLine: 1 };
    case 'diff-window':
      return changed.length === 0 ? { code: content, startLine: 1 } : joinRanges(content, windows(changed, contextLines));
    case 'declaration':
      return changed.length === 0 ? { code: content, startLine: 1 } : declarationSlice(content, changed, contextLines);
    case 'exports-only':
      return exportsSlice(content);
    case 'strings-only':
      return { code: extractStrings(content).join('\n'), startLine: 1 };
    case 'jsx-only':
      return jsxSlice(content);
  }
}

export function truncateToTokens(code: string, maxTokens: number): { code: string; truncated: boolean } {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  if (code.length <= maxChars) {
    return { code, truncated: false };
  }
  const omitted = code.length - maxChars;
  return { code: `${code.slice(0, maxChars)}\n// [truncated: ${omitted} chars omitted]`, truncated: true };
}

export interface StateConfig {
  slice: Slice;
  contextLines: number;
  maxTokens: number;
  preamble: string;
}

export interface BuildStateFromConfigInput {
  config: StateConfig;
  layer: string;
  file: SourceFile;
  hunks?: Hunk[];
}

export function buildStateFromConfig({ config, layer, file, hunks }: BuildStateFromConfigInput): BuiltState {
  const sliced = sliceCode(file.content, config.slice, hunks, config.contextLines);
  const { code, truncated } = truncateToTokens(sliced.code, config.maxTokens);
  return {
    state: { preamble: config.preamble, path: file.path, layer, slice: config.slice, code },
    startLine: sliced.startLine,
    truncated,
  };
}

export interface BuildStateInput {
  rule: Rule;
  file: SourceFile;
  hunks?: Hunk[];
}

export function buildState({ rule, file, hunks }: BuildStateInput): BuiltState {
  const config: StateConfig = rule.state ?? { slice: 'file', contextLines: 0, maxTokens: 4000, preamble: '' };
  return buildStateFromConfig({ config, layer: rule.layer, file, hunks });
}
