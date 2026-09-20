import './helpers/no-network.ts';
import { describe, expect, it } from 'bun:test';
import { RuleSchema, RulebookSchema, parseRulebook } from '../lib/rulebook.schema.ts';

const staticRule = {
  id: 'hex/domain-no-nest-decorators',
  title: 'No NestJS decorators in domain',
  layer: 'domain',
  scope: { include: ['**/domain/**/*.ts'], exclude: ['**/__tests__/**'] },
  class: 'static',
  severity: 'FAIL',
  rationale: 'Domain must not depend on the framework.',
  fix: 'Remove the decorator.',
  source: 'review-subdomain D1',
  check: { kind: 'forbidden-import', modules: ['@nestjs/*'], allow: ['@nestjs/cqrs'] },
  tags: ['purity'],
};

const noulRule = {
  id: 'hex/handler-no-business-rules',
  title: 'Handlers hold no business rules',
  layer: 'application',
  scope: { include: ['**/application/**/*.handler.ts'] },
  class: 'semantic',
  severity: 'FAIL',
  rationale: 'Business rules belong to entities.',
  fix: 'Move the rule into the aggregate.',
  source: 'architecture-reviewer god handler',
  question: { type: 'noul', instructions: 'The handler contains a business rule.' },
  state: { slice: 'file', maxTokens: 4000, preamble: 'A CQRS handler.' },
  thresholds: { deny: 0.9, ask: 0.75, advise: 0.55, uncertain: { lo: 0.35, hi: 0.65 } },
};

const choiceRule = {
  ...noulRule,
  id: 'hex/no-overengineering',
  severity: 'WARN',
  question: {
    type: 'choice',
    instructions: 'Which over-engineering pattern, if any, appears?',
    options: [
      { id: 'trivial-use-case', criteria: 'Use case wrapping a findById.' },
      { id: 'none', criteria: 'No over-engineering.' },
      { id: 'other', criteria: 'Something else.' },
    ],
    violatingOptions: ['trivial-use-case'],
  },
  thresholds: { advise: 0.55, minConfidence: 0.6 },
};

const rulebook = {
  $schema: 'nestjs-hexagonal/rulebook@1',
  id: 'hexagonal',
  version: '1.2.0',
  extends: [],
  model: { provider: 'typesafe', pin: 'jev-1.13.0' },
  rules: [staticRule, noulRule, choiceRule],
  overrides: [],
};

describe('RuleSchema', () => {
  it('accepts a static rule with a check', () => {
    expect(RuleSchema.safeParse(staticRule).success).toBe(true);
  });

  it('rejects a static rule without a check', () => {
    const { check: _check, ...withoutCheck } = staticRule;
    expect(RuleSchema.safeParse(withoutCheck).success).toBe(false);
  });

  it('rejects an id outside <ns>/<slug>', () => {
    expect(RuleSchema.safeParse({ ...staticRule, id: 'NoSlash' }).success).toBe(false);
    expect(RuleSchema.safeParse({ ...staticRule, id: 'hex/Upper' }).success).toBe(false);
  });

  it('accepts semantic noul and choice rules', () => {
    expect(RuleSchema.safeParse(noulRule).success).toBe(true);
    expect(RuleSchema.safeParse(choiceRule).success).toBe(true);
  });

  it('rejects a semantic rule without question or state', () => {
    const { state: _state, ...withoutState } = noulRule;
    expect(RuleSchema.safeParse(withoutState).success).toBe(false);
    const { question: _question, ...withoutQuestion } = noulRule;
    expect(RuleSchema.safeParse(withoutQuestion).success).toBe(false);
  });

  it('rejects minConfidence on a noul rule', () => {
    const bad = { ...noulRule, thresholds: { advise: 0.55, minConfidence: 0.6 } };
    expect(RuleSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects uncertain.lo/hi on a choice rule', () => {
    const bad = { ...choiceRule, thresholds: { advise: 0.55, uncertain: { lo: 0.3, hi: 0.6 } } };
    expect(RuleSchema.safeParse(bad).success).toBe(false);
  });

  it('requires the other option on choice questions', () => {
    const bad = {
      ...choiceRule,
      question: {
        ...choiceRule.question,
        options: choiceRule.question.options.filter((option) => option.id !== 'other'),
      },
    };
    expect(RuleSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects violatingOptions that are not declared options', () => {
    const bad = { ...choiceRule, question: { ...choiceRule.question, violatingOptions: ['ghost'] } };
    expect(RuleSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts a score question with 2..10 levels and rejects 1 level', () => {
    const score = {
      ...choiceRule,
      question: {
        type: 'score',
        instructions: 'How thin is the controller?',
        levels: [
          { id: 'thin', criteria: 'Only delegates.' },
          { id: 'fat', criteria: 'Contains rules.' },
        ],
        violatingLevels: ['fat'],
      },
    };
    expect(RuleSchema.safeParse(score).success).toBe(true);
    const oneLevel = { ...score, question: { ...score.question, levels: [score.question.levels[0]], violatingLevels: [] } };
    expect(RuleSchema.safeParse(oneLevel).success).toBe(false);
  });

  it('caps state.maxTokens at 8000 and preamble at 600 chars', () => {
    expect(RuleSchema.safeParse({ ...noulRule, state: { ...noulRule.state, maxTokens: 8001 } }).success).toBe(false);
    expect(RuleSchema.safeParse({ ...noulRule, state: { ...noulRule.state, preamble: 'x'.repeat(601) } }).success).toBe(false);
  });

  it('requires runtime on runtime rules', () => {
    const runtime = { ...staticRule, id: 'hex/tests-coverage', class: 'runtime', check: undefined };
    expect(RuleSchema.safeParse(runtime).success).toBe(false);
    expect(RuleSchema.safeParse({ ...runtime, runtime: { runner: 'package-test', gate: 'spec per entity' } }).success).toBe(true);
  });

  it('validates each check kind', () => {
    const kinds = [
      { kind: 'regex', pattern: 'foo', flags: 'gi' },
      { kind: 'regex', pattern: 'foo', mustMatch: true },
      { kind: 'required-import', modules: ['**/*data-builder*'], whenPattern: 'Entity\\.create\\(' },
      { kind: 'line-count', selector: 'method', name: 'execute', max: 20 },
      { kind: 'line-count', selector: 'file', max: 300 },
      { kind: 'external', executorId: 'hex/pattern-consistent' },
    ];
    for (const check of kinds) {
      expect(RuleSchema.safeParse({ ...staticRule, check }).success).toBe(true);
    }
    expect(RuleSchema.safeParse({ ...staticRule, check: { kind: 'regex', pattern: '(', flags: 'g' } }).success).toBe(false);
    expect(RuleSchema.safeParse({ ...staticRule, check: { kind: 'regex', pattern: 'x', flags: 'q' } }).success).toBe(false);
    expect(RuleSchema.safeParse({ ...staticRule, check: { kind: 'nope' } }).success).toBe(false);
  });

  it('defaults tags and scope.exclude', () => {
    const parsed = RuleSchema.parse(staticRule);
    expect(parsed.tags).toEqual(['purity']);
    const { tags: _tags, ...noTags } = staticRule;
    expect(RuleSchema.parse({ ...noTags, scope: { include: ['**'] } })).toMatchObject({ tags: [], scope: { exclude: [] } });
  });
});

describe('RulebookSchema', () => {
  it('accepts a valid rulebook', () => {
    expect(RulebookSchema.safeParse(rulebook).success).toBe(true);
  });

  it('rejects a wrong $schema or provider', () => {
    expect(RulebookSchema.safeParse({ ...rulebook, $schema: 'other' }).success).toBe(false);
    expect(RulebookSchema.safeParse({ ...rulebook, model: { provider: 'openai', pin: 'x' } }).success).toBe(false);
  });

  it('requires sha256 stamps on extends', () => {
    expect(RulebookSchema.safeParse({ ...rulebook, extends: [{ id: 'hexagonal', version: '1.2.0' }] }).success).toBe(false);
    expect(
      RulebookSchema.safeParse({ ...rulebook, extends: [{ id: 'hexagonal', version: '1.2.0', sha256: 'a'.repeat(64) }] }).success,
    ).toBe(true);
  });

  it('rejects duplicate rule ids inside one rulebook', () => {
    expect(RulebookSchema.safeParse({ ...rulebook, rules: [staticRule, staticRule] }).success).toBe(false);
  });

  it('accepts overrides with partial thresholds', () => {
    const overrides = [{ id: 'hex/handler-no-business-rules', severity: 'WARN', thresholds: { uncertain: { hi: 0.7 } } }];
    expect(RulebookSchema.safeParse({ ...rulebook, overrides }).success).toBe(true);
  });

  it('parseRulebook returns a readable error message', () => {
    const result = parseRulebook({ ...rulebook, rules: [{ id: 'x' }] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('rules');
    }
  });
});
