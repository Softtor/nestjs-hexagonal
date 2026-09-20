export interface Scope {
  include: string[];
  exclude: string[];
}

const REGEX_SPECIALS = /[.+^$()|[\]\\]/g;

export function normalizePath(path: string): string {
  let normalized = path.replace(/\\/g, '/');
  while (normalized.startsWith('./')) {
    normalized = normalized.slice(2);
  }
  return normalized;
}

function expandBraces(pattern: string): string[] {
  const start = pattern.indexOf('{');
  if (start === -1) {
    return [pattern];
  }
  let depth = 0;
  for (let i = start; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        const head = pattern.slice(0, start);
        const body = pattern.slice(start + 1, i);
        const tail = pattern.slice(i + 1);
        return splitTopLevel(body).flatMap((option) => expandBraces(head + option + tail));
      }
    }
  }
  return [pattern];
}

function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of body) {
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
    }
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

function segmentToRegex(segment: string): string {
  let out = '';
  let i = 0;
  while (i < segment.length) {
    const char = segment[i];
    if (char === '*') {
      if (segment[i + 1] === '*') {
        out += '.*';
        i += 2;
        continue;
      }
      out += '[^/]*';
    } else if (char === '?') {
      out += '[^/]';
    } else {
      out += char.replace(REGEX_SPECIALS, '\\$&');
    }
    i += 1;
  }
  return out;
}

function singleGlobToRegexSource(pattern: string): string {
  const segments = normalizePath(pattern).split('/');
  const parts: string[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const isLast = index === segments.length - 1;
    if (segment === '**') {
      parts.push(isLast ? '.*' : '(?:.*/)?');
      continue;
    }
    parts.push(segmentToRegex(segment) + (isLast ? '' : '/'));
  }
  return parts.join('');
}

export function globToRegExp(pattern: string): RegExp {
  const alternatives = expandBraces(pattern).map(singleGlobToRegexSource);
  return new RegExp(`^(?:${alternatives.join('|')})$`);
}

const cache = new Map<string, RegExp>();

export function matchGlob(pattern: string, path: string): boolean {
  let regex = cache.get(pattern);
  if (!regex) {
    regex = globToRegExp(pattern);
    cache.set(pattern, regex);
  }
  return regex.test(normalizePath(path));
}

export function isInScope(scope: Scope, path: string): boolean {
  const normalized = normalizePath(path);
  const included = scope.include.some((pattern) => matchGlob(pattern, normalized));
  if (!included) {
    return false;
  }
  return !scope.exclude.some((pattern) => matchGlob(pattern, normalized));
}
