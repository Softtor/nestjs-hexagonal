import './helpers/no-network.ts';
import { describe, expect, it } from 'bun:test';
import { join, resolve } from 'node:path';
import { composeRulebook, readRulebookFile, sha256Of, type BaseResolver } from '../lib/compose.ts';
import { parseRulebook, type Rulebook } from '../lib/rulebook.schema.ts';
import { runStaticRules, type SourceFile } from '../lib/static-engine.ts';

// Issue #15: a project whose tenant isolation is enforced by Postgres RLS
// queries by an aggregate id that is already tenant-bound. The shipped rule
// only accepts organizationId in the enclosing method, so every such method
// was a FAIL. The project rulebook can now widen the accepted scope through
// overrides[].check.unlessInEnclosingDeclaration; the base rule is unchanged.

const PLUGIN_ROOT = resolve(import.meta.dir, '../..');
const RULE_ID = 'softtor/tenant-scoped-query';
const conventionsPath = join(PLUGIN_ROOT, 'rulebooks', 'softtor-conventions.rulebook.yaml');
const conventions = readRulebookFile(conventionsPath);

const resolver: BaseResolver = (id) =>
  id === 'softtor-conventions' ? { rulebook: conventions.rulebook, sha256: sha256Of(conventions.text), path: conventionsPath } : null;

function projectRulebook(overrides: unknown[]): Rulebook {
  const parsed = parseRulebook({
    $schema: 'nestjs-hexagonal/rulebook@1',
    id: 'pilot',
    version: '0.1.0',
    extends: [{ id: 'softtor-conventions', version: conventions.rulebook.version, sha256: sha256Of(conventions.text) }],
    model: { provider: 'typesafe', pin: 'jev-1.13.0' },
    rules: [],
    overrides,
  });
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.rulebook;
}

const RLS_SCOPE = '\\b(?:organizationId|conversationId|subscriptionId)\\b|\\bprisma\\.(?:message|invoice)\\.findUnique\\s*\\(\\s*\\{\\s*where:\\s*\\{\\s*id\\s*\\}';

const rlsRepository: SourceFile = {
  path: 'src/chat/infrastructure/database/prisma/repositories/prisma-message.repository.ts',
  content: [
    'export class PrismaMessageRepository {',
    '  constructor(private readonly prisma: PrismaService) {}',
    '',
    '  async listByConversation(conversationId: string): Promise<unknown[]> {',
    '    return this.prisma.message.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" } });',
    '  }',
    '',
    '  async findById(id: string): Promise<unknown | null> {',
    '    return this.prisma.message.findUnique({ where: { id } });',
    '  }',
    '',
    '  async markRead(subscriptionId: string): Promise<void> {',
    '    await this.prisma.message.updateMany({ where: { subscriptionId }, data: { read: true } });',
    '  }',
    '}',
  ].join('\n'),
};

const unscopedRepository: SourceFile = {
  path: 'src/billing/infrastructure/database/prisma/repositories/prisma-order.repository.ts',
  content: [
    'export class PrismaOrderRepository {',
    '  constructor(private readonly prisma: PrismaService) {}',
    '',
    '  async findAll(): Promise<unknown[]> {',
    '    return this.prisma.order.findMany();',
    '  }',
    '',
    '  async findByCustomer(customerId: string): Promise<unknown | null> {',
    '    return this.prisma.order.findFirst({ where: { customerId } });',
    '  }',
    '',
    '  async findById(id: string): Promise<unknown | null> {',
    '    return this.prisma.order.findUnique({ where: { id } });',
    '  }',
    '}',
  ].join('\n'),
};

function tenantFindings(rulebook: Rulebook, files: SourceFile[]): number[] {
  const composed = composeRulebook(rulebook, resolver);
  return runStaticRules(composed.rules, files)
    .findings.filter((finding) => finding.ruleId === RULE_ID)
    .map((finding) => finding.line ?? 0);
}

describe(`${RULE_ID} under RLS (issue #15)`, () => {
  it('base rule keeps flagging aggregate-scoped queries when nothing is overridden', () => {
    expect(tenantFindings(projectRulebook([]), [rlsRepository])).toEqual([5, 9, 13]);
  });

  it('a project override widens the accepted scope to the aggregate ids it declares', () => {
    const rulebook = projectRulebook([{ id: RULE_ID, check: { unlessInEnclosingDeclaration: RLS_SCOPE } }]);
    expect(tenantFindings(rulebook, [rlsRepository])).toEqual([]);
  });

  it('the override keeps firing on methods with no declared scope and on models outside the RLS list', () => {
    const rulebook = projectRulebook([{ id: RULE_ID, check: { unlessInEnclosingDeclaration: RLS_SCOPE } }]);
    expect(tenantFindings(rulebook, [unscopedRepository])).toEqual([5, 9, 13]);
  });

  it('a bad override regex is rejected by the schema', () => {
    const parsed = parseRulebook({
      $schema: 'nestjs-hexagonal/rulebook@1',
      id: 'pilot',
      version: '0.1.0',
      model: { provider: 'typesafe', pin: 'jev-1.13.0' },
      overrides: [{ id: RULE_ID, check: { unlessInEnclosingDeclaration: '(' } }],
    });
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.error).toContain('unlessInEnclosingDeclaration');
  });
});
