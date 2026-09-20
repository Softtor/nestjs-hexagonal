import { lineAt, maskCommentsAndStrings, type Executor, type Finding, type SourceFile } from '../static-engine.ts';

const TOKEN_EXPORT = /export\s+const\s+(\w+)\s*=\s*Symbol\s*\(/g;
const FUNCTION_EXPORT = /^[ \t]*export\s+(?:async\s+)?function\s*\*?\s*(\w+)\s*\(/gm;
const ARROW_EXPORT = /^[ \t]*export\s+const\s+(\w+)\s*(?::[^=]*)?=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*(?::[^=]*)?=>/gm;
const TEST_OR_BUILDER = /(?:__tests__|\.spec\.|\.test\.|\/testing\/|data-builder|\.builder\.)/;

type Masked = (file: SourceFile) => string;

function maskedReader(): Masked {
  const cache = new Map<string, string>();
  return (file) => {
    let masked = cache.get(file.path);
    if (masked === undefined) {
      masked = maskCommentsAndStrings(file.content);
      cache.set(file.path, masked);
    }
    return masked;
  };
}

function referencedBy(name: string, files: SourceFile[], definer: string, masked: Masked): string[] {
  const pattern = new RegExp(`\\b${name}\\b`);
  return files.filter((file) => file.path !== definer && pattern.test(masked(file))).map((file) => file.path);
}

function injectedBy(name: string, files: SourceFile[], definer: string, masked: Masked): string[] {
  const pattern = new RegExp(`@Inject\\s*\\(\\s*${name}\\s*\\)`);
  return files.filter((file) => file.path !== definer && pattern.test(masked(file))).map((file) => file.path);
}

export const noOverengineeringStaticExecutor: Executor = (rule, scopedFiles, allFiles) => {
  const findings: Finding[] = [];
  const maskedOf = maskedReader();

  for (const file of scopedFiles) {
    if (TEST_OR_BUILDER.test(file.path)) {
      continue;
    }
    const masked = maskedOf(file);

    if (file.path.includes('/ports/') || file.path.endsWith('.port.ts')) {
      for (const match of masked.matchAll(TOKEN_EXPORT)) {
        const token = match[1];
        if (token !== undefined && injectedBy(token, allFiles, file.path, maskedOf).length === 0) {
          findings.push({
            ruleId: rule.id,
            severity: rule.severity,
            path: file.path,
            line: lineAt(file.content, match.index),
            evidence: `port token ${token} has no @Inject consumer`,
            fix: rule.fix,
            class: 'static',
          });
        }
      }
    }

    for (const pattern of [FUNCTION_EXPORT, ARROW_EXPORT]) {
      for (const match of masked.matchAll(pattern)) {
        const name = match[1];
        if (name === undefined) {
          continue;
        }
        const callers = referencedBy(name, allFiles, file.path, maskedOf).filter((path) => !TEST_OR_BUILDER.test(path));
        if (callers.length === 1) {
          findings.push({
            ruleId: rule.id,
            severity: rule.severity,
            path: file.path,
            line: lineAt(file.content, match.index),
            evidence: `helper ${name} has exactly one caller (${callers[0]}); inline it`,
            fix: rule.fix,
            class: 'static',
          });
        }
      }
    }
  }

  return findings;
};
