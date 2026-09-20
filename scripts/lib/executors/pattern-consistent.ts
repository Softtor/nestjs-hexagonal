import { maskCommentsAndStrings, type Executor, type Finding } from '../static-engine.ts';

type Pattern = 'A' | 'B' | 'C';

const HANDLER_DECORATOR = /@(?:CommandHandler|QueryHandler)\s*\(/;
const ORCHESTRATOR_INSTANCE = /\bnew\s+\w*UseCase(?:\.\w+)?\s*\(/;
const PLAIN_USE_CASE = /\bexecute\s*\(/;
const TOKEN_EXPORT = /export\s+const\s+\w+\s*=\s*Symbol\s*\(/;
const EVENT_PUBLISHER = /\bEventPublisher\b|\.commit\s*\(\)/;

export function classifyPattern(content: string): Pattern | null {
  const masked = maskCommentsAndStrings(content);
  if (HANDLER_DECORATOR.test(masked)) {
    if (ORCHESTRATOR_INSTANCE.test(masked)) {
      return 'C';
    }
    return EVENT_PUBLISHER.test(masked) ? 'B' : null;
  }
  if (PLAIN_USE_CASE.test(masked) && TOKEN_EXPORT.test(masked)) {
    return 'A';
  }
  return null;
}

export function boundedContextOf(path: string): string | null {
  const index = path.indexOf('/application/');
  if (index === -1) {
    return path.startsWith('application/') ? '' : null;
  }
  return path.slice(0, index);
}

export const patternConsistentExecutor: Executor = (rule, scopedFiles) => {
  const byContext = new Map<string, Map<Pattern, string[]>>();

  for (const file of scopedFiles) {
    const context = boundedContextOf(file.path);
    if (context === null) {
      continue;
    }
    const pattern = classifyPattern(file.content);
    if (!pattern) {
      continue;
    }
    const patterns = byContext.get(context) ?? new Map<Pattern, string[]>();
    patterns.set(pattern, [...(patterns.get(pattern) ?? []), file.path]);
    byContext.set(context, patterns);
  }

  const findings: Finding[] = [];
  for (const [context, patterns] of byContext) {
    if (patterns.size < 2) {
      continue;
    }
    const summary = [...patterns.entries()]
      .map(([pattern, files]) => `${pattern}: ${files.length} file(s), e.g. ${files[0]}`)
      .join('; ');
    findings.push({
      ruleId: rule.id,
      severity: rule.severity,
      path: context === '' ? 'application' : `${context}/application`,
      evidence: `bounded context mixes application patterns (${summary})`,
      fix: rule.fix,
      class: 'static',
    });
  }
  return findings;
};

