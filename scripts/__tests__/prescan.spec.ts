import './helpers/no-network.ts';
import { assertNetworkForbidden } from './helpers/no-network.ts';
import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import { runCli, type CliIo } from '../check.ts';
import type { FetchLike } from '../lib/jev-client.ts';
import { ARTIFACT_KINDS, classifyKind, classifyLayer, testSiblings, type PrescanEntry } from '../prescan.ts';

const PLUGIN_ROOT = resolve(import.meta.dir, '../..');
const EXAMPLE = 'examples/order-bounded-context';
const KEY = 'sk-prescan-secret';

interface Captured extends CliIo {
  out: string[];
  err: string[];
}

function capture(): Captured {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (text) => { out.push(text); }, stderr: (text) => { err.push(text); } };
}

interface PrescanReport {
  files: number;
  entries: PrescanEntry[];
  semantic?: { requests: number; skippedReason?: string };
}

function isPrescanReport(value: unknown): value is PrescanReport {
  return typeof value === 'object' && value !== null && 'entries' in value && Array.isArray(value.entries);
}

async function run(args: string[], env: Record<string, string | undefined> = {}, fetchImpl?: FetchLike): Promise<{ code: number; io: Captured }> {
  const io = capture();
  const code = await runCli(['prescan', ...args], io, { cwd: PLUGIN_ROOT, env, pluginRoot: PLUGIN_ROOT, ...(fetchImpl ? { fetchImpl } : {}) });
  return { code, io };
}

async function runJson(args: string[], env: Record<string, string | undefined> = {}, fetchImpl?: FetchLike): Promise<{ code: number; report: PrescanReport; io: Captured }> {
  const { code, io } = await run([...args, '--format', 'json'], env, fetchImpl);
  const parsed: unknown = JSON.parse(io.out.join(''));
  if (!isPrescanReport(parsed)) {
    throw new Error(`unexpected report: ${io.out.join('')}`);
  }
  return { code, report: parsed, io };
}

function entry(report: PrescanReport, suffix: string): PrescanEntry {
  const found = report.entries.find((candidate) => candidate.path.endsWith(suffix));
  if (found === undefined) {
    throw new Error(`no entry for ${suffix}`);
  }
  return found;
}

describe('classifyLayer', () => {
  it('reads the layer from the path, controllers count as presentation', () => {
    expect(classifyLayer('src/orders/domain/entities/order.entity.ts')).toBe('domain');
    expect(classifyLayer('src/orders/application/commands/x.handler.ts')).toBe('application');
    expect(classifyLayer('src/orders/infrastructure/controllers/orders.controller.ts')).toBe('presentation');
    expect(classifyLayer('src/orders/presentation/orders.controller.ts')).toBe('presentation');
    expect(classifyLayer('src/orders/infrastructure/orders.module.ts')).toBe('infrastructure');
    expect(classifyLayer('src/main.ts')).toBe('other');
  });
});

describe('classifyKind', () => {
  it('prefers the decorator over the file name and falls back to naming conventions', () => {
    expect(classifyKind('a/x.service.ts', '@Module({})\nexport class X {}')).toBe('module');
    expect(classifyKind('a/x.ts', '@EventsHandler(E)\nexport class X {}')).toBe('listener');
    expect(classifyKind('a/x.ts', '@CommandHandler(C)\nexport class X {}')).toBe('handler');
    expect(classifyKind('a/x.ts', '@QueryHandler(Q)\nexport class X {}')).toBe('handler');
    expect(classifyKind('a/x.ts', "@Controller('x')\nexport class X {}")).toBe('controller');
    expect(classifyKind('a/x.ts', 'export class X extends AggregateRoot {}')).toBe('entity');
    expect(classifyKind('a/x.ts', 'export class X extends ValueObject<string> {}')).toBe('vo');
    expect(classifyKind('a/x.ts', 'export class X implements IEvent {}')).toBe('event');
    expect(classifyKind('a/domain/repositories/x.repository.ts', 'export interface X {}')).toBe('repo-interface');
    expect(classifyKind('a/application/usecases/x.usecase.ts', 'export class X { execute() {} }')).toBe('use-case');
    expect(classifyKind('a/application/dtos/x.dto.ts', 'export interface X {}')).toBe('dto');
    expect(classifyKind('a/infrastructure/adapters/x.adapter.ts', 'export class X {}')).toBe('adapter');
    expect(classifyKind('a/infrastructure/database/prisma/repositories/prisma-x.repository.ts', 'export class X {}')).toBe('adapter');
    expect(classifyKind('a/__tests__/x.spec.ts', 'describe()')).toBe('test');
    expect(classifyKind('a/x.mapper.ts', 'export class XMapper {}')).toBe('other');
    expect(ARTIFACT_KINDS).toContain('other');
  });
});

describe('testSiblings', () => {
  it('lists the spec paths a file may have', () => {
    expect(testSiblings('src/a/order.entity.ts')).toEqual(['src/a/__tests__/order.entity.spec.ts', 'src/a/__tests__/order.entity.test.ts', 'src/a/order.entity.spec.ts', 'src/a/order.entity.test.ts']);
  });
});

describe('prescan on the example bounded context', () => {
  it('classifies every artifact, marks test siblings and sorts by layer', async () => {
    const { code, report } = await runJson(['--files', `${EXAMPLE}/**/*.ts`]);
    expect(code).toBe(0);
    expect(report.files).toBe(report.entries.length);
    expect(entry(report, 'domain/entities/order.entity.ts')).toMatchObject({ layer: 'domain', kind: 'entity', hasTests: true });
    expect(entry(report, 'domain/value-objects/money.vo.ts')).toMatchObject({ layer: 'domain', kind: 'vo', hasTests: false });
    expect(entry(report, 'domain/value-objects/order-status.vo.ts')).toMatchObject({ kind: 'vo', hasTests: true });
    expect(entry(report, 'domain/events/order-paid.event.ts')).toMatchObject({ kind: 'event' });
    expect(entry(report, 'domain/repositories/order.repository.ts')).toMatchObject({ kind: 'repo-interface' });
    expect(entry(report, 'domain/testing/helpers/order.data-builder.ts')).toMatchObject({ layer: 'domain', kind: 'other' });
    expect(entry(report, 'application/commands/create-order.handler.ts')).toMatchObject({ layer: 'application', kind: 'handler', hasTests: true });
    expect(entry(report, 'application/commands/cancel-order.handler.ts')).toMatchObject({ kind: 'handler', hasTests: false });
    expect(entry(report, 'application/queries/get-order.handler.ts')).toMatchObject({ kind: 'handler' });
    expect(entry(report, 'application/dtos/create-order.dto.ts')).toMatchObject({ kind: 'dto' });
    expect(entry(report, 'application/ports/payment-gateway.port.ts')).toMatchObject({ layer: 'application', kind: 'other' });
    expect(entry(report, 'infrastructure/orders.module.ts')).toMatchObject({ layer: 'infrastructure', kind: 'module' });
    expect(entry(report, 'infrastructure/listeners/order-paid-invoice.handler.ts')).toMatchObject({ kind: 'listener' });
    expect(entry(report, 'infrastructure/adapters/payment-gateway.adapter.ts')).toMatchObject({ kind: 'adapter' });
    expect(entry(report, 'prisma/repositories/prisma-order.repository.ts')).toMatchObject({ kind: 'adapter' });
    expect(entry(report, 'infrastructure/controllers/orders.controller.ts')).toMatchObject({ layer: 'presentation', kind: 'controller' });
    expect(entry(report, 'controllers/dtos/create-order.request.dto.ts')).toMatchObject({ layer: 'presentation', kind: 'dto' });
    expect(entry(report, 'domain/entities/__tests__/order.entity.spec.ts')).toMatchObject({ layer: 'domain', kind: 'test' });
    for (const item of report.entries) {
      expect(item.lines).toBeGreaterThan(0);
    }
    const layers = report.entries.map((item) => item.layer);
    const order = ['domain', 'application', 'infrastructure', 'presentation', 'other'];
    const ranks = layers.map((layer) => order.indexOf(layer));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    assertNetworkForbidden();
  });

  it('classifies golden cases by their layered path', async () => {
    const { report } = await runJson(['--files', 'calibration/golden/hex/handler-no-business-rules/bad/computes-total-from-items/**']);
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]).toMatchObject({ layer: 'application', kind: 'handler', hasTests: false });
  });

  it('prints one line per file grouped by layer in text format', async () => {
    const { code, io } = await run(['--files', `${EXAMPLE}/domain/entities/order.entity.ts`, `${EXAMPLE}/infrastructure/orders.module.ts`]);
    expect(code).toBe(0);
    const text = io.out.join('');
    expect(text.indexOf('domain')).toBeLessThan(text.indexOf('infrastructure'));
    expect(text).toContain('entity');
    expect(text).toContain('module');
    expect(text).toContain('2 file(s)');
  });

  it('requires --files or --diff', async () => {
    const { code, io } = await run([]);
    expect(code).toBe(2);
    expect(io.err.join('')).toContain('--files');
  });
});

describe('prescan --semantic', () => {
  it('skips with a notice and no network when the key is absent', async () => {
    const { code, report, io } = await runJson(['--files', `${EXAMPLE}/domain/entities/order.entity.ts`, '--semantic']);
    expect(code).toBe(0);
    expect(report.semantic?.requests).toBe(0);
    expect(report.semantic?.skippedReason).toContain('TYPESAFE_API_KEY');
    expect(io.err.join('')).toContain('TYPESAFE_API_KEY');
    expect(report.entries[0]?.semantic).toBeUndefined();
    assertNetworkForbidden();
  });

  it('asks Jev one choice question per file through the injected fetch and records the answer', async () => {
    const bodies: string[] = [];
    const fetchImpl: FetchLike = (_url, init) => {
      bodies.push(String(init.body));
      return Promise.resolve(
        new Response(
          JSON.stringify({ model: 'jev-1.13.0', answers: { kind: { type: 'choice', choice: 'entity', confidence: 0.93, probabilities: { entity: 0.93, other: 0.07 } } }, usage: { input_tokens: 100, output_tokens: 2 } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    };
    const { code, report, io } = await runJson(['--files', `${EXAMPLE}/domain/entities/order.entity.ts`, `${EXAMPLE}/domain/value-objects/money.vo.ts`, '--semantic'], { TYPESAFE_API_KEY: KEY }, fetchImpl);
    expect(code).toBe(0);
    expect(bodies).toHaveLength(2);
    expect(report.semantic?.requests).toBe(2);
    for (const body of bodies) {
      const parsed: unknown = JSON.parse(body);
      expect(parsed).toMatchObject({ model: 'jev-1.13.0', questions: { kind: { type: 'choice' } } });
      expect(body).toContain('"other"');
      for (const kind of ARTIFACT_KINDS) {
        expect(body).toContain(`"${kind}"`);
      }
    }
    expect(entry(report, 'order.entity.ts').semantic).toEqual({ kind: 'entity', confidence: 0.93, agrees: true });
    expect(entry(report, 'money.vo.ts').semantic).toEqual({ kind: 'entity', confidence: 0.93, agrees: false });
    expect([...io.out, ...io.err].join('')).not.toContain(KEY);
  });
});
