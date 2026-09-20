import { z } from 'zod';

export const RULEBOOK_SCHEMA_ID = 'nestjs-hexagonal/rulebook@1';

const RULE_ID_PATTERN = /^[a-z0-9-]+\/[a-z0-9-]+$/;
const REGEX_FLAGS_PATTERN = /^[gimsuv]*$/;

function isValidRegex(pattern: string, flags: string): boolean {
  try {
    new RegExp(pattern, flags);
    return true;
  } catch {
    return false;
  }
}

const RegexCheckSchema = z
  .object({
    kind: z.literal('regex'),
    pattern: z.string().min(1),
    flags: z.string().regex(REGEX_FLAGS_PATTERN).default(''),
    mustMatch: z.boolean().default(false),
    maxMatches: z.number().int().nonnegative().optional(),
    whenPattern: z.string().min(1).optional(),
    unlessInEnclosingDeclaration: z.string().min(1).optional(),
  })
  .superRefine((check, ctx) => {
    if (check.unlessInEnclosingDeclaration !== undefined && !isValidRegex(check.unlessInEnclosingDeclaration, '')) {
      ctx.addIssue({ code: 'custom', path: ['unlessInEnclosingDeclaration'], message: 'invalid regular expression' });
    }
    if (!isValidRegex(check.pattern, check.flags)) {
      ctx.addIssue({ code: 'custom', path: ['pattern'], message: 'invalid regular expression' });
    }
    if (check.whenPattern !== undefined && !isValidRegex(check.whenPattern, '')) {
      ctx.addIssue({ code: 'custom', path: ['whenPattern'], message: 'invalid regular expression' });
    }
  });

const ForbiddenImportCheckSchema = z.object({
  kind: z.literal('forbidden-import'),
  modules: z.array(z.string().min(1)).min(1),
  allow: z.array(z.string().min(1)).default([]),
});

const RequiredImportCheckSchema = z
  .object({
    kind: z.literal('required-import'),
    modules: z.array(z.string().min(1)).min(1),
    whenPattern: z.string().min(1).optional(),
  })
  .superRefine((check, ctx) => {
    if (check.whenPattern !== undefined && !isValidRegex(check.whenPattern, '')) {
      ctx.addIssue({ code: 'custom', path: ['whenPattern'], message: 'invalid regular expression' });
    }
  });

const LineCountCheckSchema = z.object({
  kind: z.literal('line-count'),
  selector: z.enum(['function', 'method', 'file']),
  name: z.string().min(1).optional(),
  max: z.number().int().positive(),
});

const ExternalCheckSchema = z.object({
  kind: z.literal('external'),
  executorId: z.string().min(1),
});

export const CheckSchema = z.discriminatedUnion('kind', [
  RegexCheckSchema,
  ForbiddenImportCheckSchema,
  RequiredImportCheckSchema,
  LineCountCheckSchema,
  ExternalCheckSchema,
]);

const OptionSchema = z.object({
  id: z.string().min(1),
  criteria: z.string().min(1),
});

const NoulQuestionSchema = z.object({
  type: z.literal('noul'),
  instructions: z.string().min(1),
});

const ChoiceQuestionSchema = z
  .object({
    type: z.literal('choice'),
    instructions: z.string().min(1),
    options: z.array(OptionSchema).min(2).max(255),
    violatingOptions: z.array(z.string().min(1)).min(1),
  })
  .superRefine((question, ctx) => {
    const ids = question.options.map((option) => option.id);
    if (!ids.includes('other')) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: "choice questions must declare an 'other' option" });
    }
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'option ids must be unique' });
    }
    for (const violating of question.violatingOptions) {
      if (!ids.includes(violating)) {
        ctx.addIssue({ code: 'custom', path: ['violatingOptions'], message: `unknown option '${violating}'` });
      }
    }
  });

const ScoreQuestionSchema = z
  .object({
    type: z.literal('score'),
    instructions: z.string().min(1),
    levels: z.array(OptionSchema).min(2).max(10),
    violatingLevels: z.array(z.string().min(1)).min(1),
  })
  .superRefine((question, ctx) => {
    const ids = question.levels.map((level) => level.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['levels'], message: 'level ids must be unique' });
    }
    for (const violating of question.violatingLevels) {
      if (!ids.includes(violating)) {
        ctx.addIssue({ code: 'custom', path: ['violatingLevels'], message: `unknown level '${violating}'` });
      }
    }
  });

export const QuestionSchema = z.discriminatedUnion('type', [NoulQuestionSchema, ChoiceQuestionSchema, ScoreQuestionSchema]);

export const StateSchema = z.object({
  slice: z.enum(['file', 'diff-window', 'declaration', 'exports-only', 'strings-only', 'jsx-only']).default('file'),
  contextLines: z.number().int().nonnegative().default(0),
  maxTokens: z.number().int().positive().max(8000).default(4000),
  preamble: z.string().max(600).default(''),
});

const Probability = z.number().min(0).max(1);
const DENY_NOT_ALLOWED = 'deny is not allowed in a rulebook; it only exists in calibration/fitted/<pin>.json';
const NoDeny = z.undefined({ error: DENY_NOT_ALLOWED }).optional();

export const NoulThresholdsSchema = z
  .object({
    deny: NoDeny,
    ask: Probability.optional(),
    advise: Probability,
    uncertain: z.object({ lo: Probability, hi: Probability }),
  })
  .strict();

export const DistributionThresholdsSchema = z
  .object({
    deny: NoDeny,
    ask: Probability.optional(),
    advise: Probability,
    minConfidence: Probability,
  })
  .strict();

const RejectDeny = z.object({ deny: NoDeny }).loose();

export const ThresholdsSchema = RejectDeny.pipe(z.union([NoulThresholdsSchema, DistributionThresholdsSchema]));

export const ThresholdsOverrideSchema = z
  .object({
    deny: NoDeny,
    ask: Probability.optional(),
    advise: Probability.optional(),
    minConfidence: Probability.optional(),
    uncertain: z.object({ lo: Probability.optional(), hi: Probability.optional() }).optional(),
  })
  .strict();

export const RuntimeSchema = z.object({
  runner: z.string().min(1),
  gate: z.string().min(1),
});

export const ScopeSchema = z.object({
  include: z.array(z.string().min(1)).min(1),
  exclude: z.array(z.string().min(1)).default([]),
});

export const LayerSchema = z.enum(['domain', 'application', 'infrastructure', 'presentation', 'testing', 'any']);
export const SeveritySchema = z.enum(['FAIL', 'WARN']);
export const RuleClassSchema = z.enum(['static', 'semantic', 'runtime']);

const RuleBaseSchema = z.object({
  id: z.string().regex(RULE_ID_PATTERN, 'rule id must match <ns>/<slug> in lowercase'),
  title: z.string().min(1),
  layer: LayerSchema,
  scope: ScopeSchema,
  class: RuleClassSchema,
  severity: SeveritySchema,
  rationale: z.string().min(1),
  fix: z.string().min(1),
  source: z.string().min(1).optional(),
  check: CheckSchema.optional(),
  question: QuestionSchema.optional(),
  state: StateSchema.optional(),
  thresholds: ThresholdsSchema.optional(),
  runtime: RuntimeSchema.optional(),
  tags: z.array(z.string().min(1)).default([]),
});

export function validateThresholdsForQuestion(
  question: z.infer<typeof QuestionSchema> | undefined,
  thresholds: { [key: string]: unknown } | undefined,
): string | null {
  if (!thresholds) {
    return null;
  }
  if (!question) {
    return 'thresholds require a question';
  }
  const hasUncertain = 'uncertain' in thresholds;
  const hasMinConfidence = 'minConfidence' in thresholds;
  if (question.type === 'noul') {
    if (hasMinConfidence) {
      return 'noul rules use thresholds.uncertain, not minConfidence';
    }
    if (!hasUncertain) {
      return 'noul rules require thresholds.uncertain { lo, hi }';
    }
    return null;
  }
  if (hasUncertain) {
    return `${question.type} rules use thresholds.minConfidence, not uncertain`;
  }
  if (!hasMinConfidence) {
    return `${question.type} rules require thresholds.minConfidence`;
  }
  return null;
}

export const RuleSchema = RuleBaseSchema.superRefine((rule, ctx) => {
  if (rule.class === 'static' && !rule.check) {
    ctx.addIssue({ code: 'custom', path: ['check'], message: 'static rules require a check' });
  }
  if (rule.class === 'semantic') {
    if (!rule.question) {
      ctx.addIssue({ code: 'custom', path: ['question'], message: 'semantic rules require a question' });
    }
    if (!rule.state) {
      ctx.addIssue({ code: 'custom', path: ['state'], message: 'semantic rules require a state' });
    }
  }
  if (rule.class === 'runtime' && !rule.runtime) {
    ctx.addIssue({ code: 'custom', path: ['runtime'], message: 'runtime rules require a runtime block' });
  }
  const thresholdsError = validateThresholdsForQuestion(rule.question, rule.thresholds);
  if (thresholdsError) {
    ctx.addIssue({ code: 'custom', path: ['thresholds'], message: thresholdsError });
  }
});

export const OverrideSchema = z.object({
  id: z.string().regex(RULE_ID_PATTERN),
  disabled: z.boolean().optional(),
  severity: SeveritySchema.optional(),
  scope: z
    .object({
      include: z.array(z.string().min(1)).min(1).optional(),
      exclude: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  thresholds: ThresholdsOverrideSchema.optional(),
});

export const ExtendsEntrySchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const RulebookSchema = z
  .object({
    $schema: z.literal(RULEBOOK_SCHEMA_ID),
    id: z.string().min(1),
    version: z.string().min(1),
    extends: z.array(ExtendsEntrySchema).default([]),
    model: z.object({ provider: z.literal('typesafe'), pin: z.string().min(1) }),
    rules: z.array(RuleSchema).default([]),
    overrides: z.array(OverrideSchema).default([]),
  })
  .superRefine((rulebook, ctx) => {
    const seen = new Set<string>();
    rulebook.rules.forEach((rule, index) => {
      if (seen.has(rule.id)) {
        ctx.addIssue({ code: 'custom', path: ['rules', index, 'id'], message: `duplicate rule id '${rule.id}'` });
      }
      seen.add(rule.id);
    });
  });

export type Check = z.infer<typeof CheckSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type Thresholds = z.infer<typeof ThresholdsSchema>;
export type ThresholdsOverride = z.infer<typeof ThresholdsOverrideSchema>;
export type Rule = z.infer<typeof RuleSchema>;
export type Override = z.infer<typeof OverrideSchema>;
export type Rulebook = z.infer<typeof RulebookSchema>;
export type Severity = z.infer<typeof SeveritySchema>;
export type RuleClass = z.infer<typeof RuleClassSchema>;

export type ParseResult = { ok: true; rulebook: Rulebook } | { ok: false; error: string };

export function formatIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`).join('\n');
}

export function parseRulebook(input: unknown): ParseResult {
  const result = RulebookSchema.safeParse(input);
  if (result.success) {
    return { ok: true, rulebook: result.data };
  }
  return { ok: false, error: formatIssues(result.error) };
}
