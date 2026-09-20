import './helpers/no-network.ts';
import { describe, expect, it } from 'bun:test';
import { RuleSchema, type Rule } from '../lib/rulebook.schema.ts';
import { registerBuiltinExecutors } from '../lib/executors/index.ts';
import { hasExecutor, runStaticRules, type SourceFile } from '../lib/static-engine.ts';

registerBuiltinExecutors();

function externalRule(id: string, executorId: string, include: string[]): Rule {
  return RuleSchema.parse({
    id,
    title: id,
    layer: 'application',
    scope: { include, exclude: ['**/__tests__/**'] },
    class: 'static',
    severity: 'WARN',
    rationale: 'r',
    fix: 'f',
    check: { kind: 'external', executorId },
  });
}

function file(path: string, content: string): SourceFile {
  return { path, content };
}

const patternA = "export const CREATE_X_USE_CASE_TOKEN = Symbol('CreateXUseCase');\nexport namespace CreateXUseCase {\n  export class UseCase {\n    async execute(input: Input): Promise<void> {}\n  }\n}";
const patternB = "@CommandHandler(CreateXCommand)\nexport class CreateXHandler {\n  constructor(private readonly publisher: EventPublisher) {}\n  async execute(command: CreateXCommand): Promise<void> { entity.commit(); }\n}";
const patternC = "@CommandHandler(CreateYCommand)\nexport class CreateYHandler {\n  private readonly useCase = new CreateYUseCase.UseCase(this.repo);\n  async execute(command: CreateYCommand): Promise<void> {}\n}";
const queryHandler = "@QueryHandler(GetXQuery)\nexport class GetXHandler {\n  async execute(query: GetXQuery): Promise<Output> { return this.repo.findById(query.id); }\n}";

describe('hex/pattern-consistent executor', () => {
  const rule = externalRule('hex/pattern-consistent', 'hex/pattern-consistent', ['**/application/**/*.ts']);

  it('is registered', () => {
    expect(hasExecutor('hex/pattern-consistent')).toBe(true);
  });

  it('flags a bounded context mixing pattern A and pattern B', () => {
    const result = runStaticRules([rule], [
      file('src/orders/application/usecases/create-x.usecase.ts', patternA),
      file('src/orders/application/commands/create-x.handler.ts', patternB),
      file('src/orders/application/queries/get-x.handler.ts', queryHandler),
    ]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ ruleId: 'hex/pattern-consistent', path: 'src/orders/application', severity: 'WARN' });
    expect(result.findings[0]?.evidence).toContain('A');
    expect(result.findings[0]?.evidence).toContain('B');
  });

  it('accepts a bounded context that uses one pattern and query handlers', () => {
    const result = runStaticRules([rule], [
      file('src/orders/application/commands/create-x.handler.ts', patternB),
      file('src/orders/application/commands/cancel-x.handler.ts', patternB),
      file('src/orders/application/queries/get-x.handler.ts', queryHandler),
      file('src/orders/application/ports/mail.port.ts', "export const MAIL_PORT = Symbol('MailPort');"),
    ]);
    expect(result.findings).toHaveLength(0);
  });

  it('keeps bounded contexts independent and classifies pattern C', () => {
    const result = runStaticRules([rule], [
      file('src/orders/application/commands/create-x.handler.ts', patternB),
      file('src/billing/application/commands/create-y.handler.ts', patternC),
    ]);
    expect(result.findings).toHaveLength(0);
    const mixed = runStaticRules([rule], [
      file('src/billing/application/commands/create-y.handler.ts', patternC),
      file('src/billing/application/commands/create-x.handler.ts', patternB),
    ]);
    expect(mixed.findings).toHaveLength(1);
    expect(mixed.findings[0]?.evidence).toContain('C');
  });
});

describe('hex/no-overengineering-static executor', () => {
  const rule = externalRule('hex/no-overengineering-static', 'hex/no-overengineering-static', ['**/application/**/*.ts', '**/domain/**/*.ts']);
  const port = "export interface MailPort { send(): Promise<void>; }\nexport const MAIL_PORT = Symbol('MailPort');";

  it('is registered', () => {
    expect(hasExecutor('hex/no-overengineering-static')).toBe(true);
  });

  it('flags a port token with zero injection consumers', () => {
    const result = runStaticRules([rule], [
      file('src/x/application/ports/mail.port.ts', port),
      file('src/x/infrastructure/x.module.ts', "import { MAIL_PORT } from '../application/ports/mail.port';\nproviders: [{ provide: MAIL_PORT, useClass: MailAdapter }]"),
    ]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ path: 'src/x/application/ports/mail.port.ts', line: 2 });
    expect(result.findings[0]?.evidence).toContain('MAIL_PORT');
  });

  it('accepts a port token injected somewhere', () => {
    const result = runStaticRules([rule], [
      file('src/x/application/ports/mail.port.ts', port),
      file('src/x/application/commands/send.handler.ts', 'constructor(@Inject(MAIL_PORT) private readonly mail: MailPort) {}'),
    ]);
    expect(result.findings).toHaveLength(0);
  });

  it('flags an exported helper function referenced by exactly one other file', () => {
    const helper = 'export function normalizeName(name: string): string {\n  return name.trim();\n}';
    const single = runStaticRules([rule], [
      file('src/x/application/helpers/normalize.ts', helper),
      file('src/x/application/commands/a.handler.ts', 'normalizeName(x);'),
    ]);
    expect(single.findings).toHaveLength(1);
    expect(single.findings[0]?.evidence).toContain('normalizeName');

    const multiple = runStaticRules([rule], [
      file('src/x/application/helpers/normalize.ts', helper),
      file('src/x/application/commands/a.handler.ts', 'normalizeName(x);'),
      file('src/x/application/commands/b.handler.ts', 'normalizeName(y);'),
    ]);
    expect(multiple.findings).toHaveLength(0);

    const unused = runStaticRules([rule], [file('src/x/application/helpers/normalize.ts', helper)]);
    expect(unused.findings).toHaveLength(0);
  });

  it('ignores data builders and test helpers', () => {
    const builder = 'export function OrderDataBuilder(overrides = {}) {\n  return {};\n}';
    const result = runStaticRules([rule], [
      file('src/x/domain/testing/helpers/order.data-builder.ts', builder),
      file('src/x/domain/entities/__tests__/order.entity.spec.ts', 'OrderDataBuilder();'),
    ]);
    expect(result.findings).toHaveLength(0);
  });
});

describe('counts over the project tree', () => {
  const rule = externalRule('hex/no-overengineering-static', 'hex/no-overengineering-static', ['**/application/**/*.ts']);
  const helper = 'export function normalizeName(name: string): string {\n  return name.trim();\n}';
  const helperFile = file('src/x/application/helpers/normalize.ts', helper);
  const callerA = file('src/x/application/commands/a.handler.ts', 'normalizeName(x);');
  const callerB = file('src/x/application/commands/b.handler.ts', 'normalizeName(y);');

  it('does not flag a helper with two callers in the project when only one is in the checked set', () => {
    const result = runStaticRules([rule], [helperFile, callerA], { projectFiles: () => [helperFile, callerA, callerB] });
    expect(result.findings).toHaveLength(0);
  });

  it('still flags a helper whose only caller lives outside the checked set', () => {
    const result = runStaticRules([rule], [helperFile], { projectFiles: () => [helperFile, callerB] });
    expect(result.findings).toHaveLength(1);
  });

  it('does not count a port consumer only because it is in the checked set', () => {
    const port = file('src/x/application/ports/mail.port.ts', "export const MAIL_PORT = Symbol('MailPort');");
    const consumer = file('src/x/infrastructure/send.adapter.ts', 'constructor(@Inject(MAIL_PORT) mail: MailPort) {}');
    const result = runStaticRules([rule], [port], { projectFiles: () => [port, consumer] });
    expect(result.findings).toHaveLength(0);
  });
});
