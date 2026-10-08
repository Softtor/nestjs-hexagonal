import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { EMPTY, Observable, Subject, firstValueFrom, of, throwError } from 'rxjs';
import { concatMap, map } from 'rxjs/operators';
import { AggregateRoot, CqrsModule, EventBus, EventPublisher, EventsHandler } from '@nestjs/cqrs';
import { Test } from '@nestjs/testing';

const ROOT = resolve(import.meta.dir, '../..');
const TEMP = mkdtempSync(join(tmpdir(), 'hex-dispatcher-'));
const FILES = [
  'events/event-publisher.port', 'events/event-dispatcher', 'events/in-memory-event-publisher',
  'infrastructure/event-bus-event-publisher', 'infrastructure/nest-event-publisher-adapter', 'infrastructure/broker-event-publisher',
  'base-classes/entity', 'base-classes/domain-event', 'base-classes/unique-entity-id',
];
const EXAMPLE_DEPENDENCIES = ['repository-contracts/searchable-repository', 'repository-contracts/repository-contracts', 'base-classes/value-object', 'domain-errors/errors'];

beforeAll(() => {
  symlinkSync(join(ROOT, 'node_modules'), join(TEMP, 'node_modules'), 'dir');
  writeFileSync(join(TEMP, 'package.json'), '{"type":"module"}');
  writeFileSync(join(TEMP, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noEmit: true,
    skipLibCheck: true, experimentalDecorators: true, emitDecoratorMetadata: true,
    baseUrl: '.', paths: { '@/*': ['./*'] }, types: [],
  }, include: [...FILES.map(file => 'shared/' + file + '.ts'), 'type-contracts.ts'] }));
  for (const file of [...FILES, ...EXAMPLE_DEPENDENCIES]) {
    const source = join(ROOT, 'shared', file + '.ts.example');
    if (!existsSync(source)) continue;
    const dest = join(TEMP, 'shared', file + '.ts');
    mkdirSync(resolve(dest, '..'), { recursive: true });
    writeFileSync(dest, readFileSync(source, 'utf8'));
  }
  cpSync(join(ROOT, 'examples/order-bounded-context'), join(TEMP, 'order'), { recursive: true });
  // Copied templates and examples run with their normal application aliases.
  // Bun resolves absolute alias rewrites here; typecheck uses tsconfig paths.
  function rewrite(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) rewrite(file);
      else if (file.endsWith('.ts')) writeFileSync(file, readFileSync(file, 'utf8').replace(/(['"])@\//g, `$1${TEMP}/`));
    }
  }
  rewrite(join(TEMP, 'shared'));
  rewrite(join(TEMP, 'order'));
});
afterAll(() => rmSync(TEMP, { recursive: true, force: true }));

const load = (file: string) => import(join(TEMP, 'shared', file + '.ts'));

describe('real dispatcher templates', () => {
  it('ships runtime templates for a copyable application', () => {
    expect(FILES.filter(file => !existsSync(join(TEMP, 'shared', file + '.ts')))).toEqual([]);
  });

  it('requires typed payloads for named events and rejects invalid fluent sequences', async () => {
    writeFileSync(join(TEMP, 'type-contracts.ts'), `
      import { dispatch, EventDispatcher } from './shared/events/event-dispatcher';
      import type { EventPublisherPort } from './shared/events/event-publisher.port';
      type Events = { 'order.created': { orderId: string; total: number }; 'order.cancelled': { reason: string } };
      const publisher: EventPublisherPort = { publish() {} };
      const events = dispatch<Events>(publisher);
      events.event('order.created').with({ orderId: '1', total: 3 }).publish();
      events.event('order.created').keyedBy('1').with({ orderId: '1', total: 3 }).publish$();
      new EventDispatcher<Events>(publisher).event('order.cancelled').with({ reason: 'x' }).publish();
      // @ts-expect-error payload must match the selected event
      events.event('order.created').with({ reason: 'x' });
      // @ts-expect-error unknown event name
      events.event('other');
      // @ts-expect-error no publish before payload
      events.event('order.created').publish();
      // @ts-expect-error configuration must not bypass required payload
      events.event('order.created').keyedBy('1').withEventId('id').publish();
      class Created { readonly eventName = 'created'; }
      events.event(new Created()).publish();
      // @ts-expect-error instance already contains payload
      events.event(new Created()).with({});
    `);
    const result = Bun.spawnSync(['bun', join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', join(TEMP, 'tsconfig.json')]);
    expect(new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr)).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('shares the helper and injected API, preserves instances and immutable metadata', async () => {
    const { dispatch, EventDispatcher } = await load('events/event-dispatcher');
    const publications: any[] = [];
    const publisher = { publish: (request: unknown) => { publications.push(request); } };
    class Created { readonly eventName = 'order.created'; method() { return 42; } }
    const instance = new Created();
    const base = dispatch(publisher).event(instance).withEventId('stable');
    const branch = base.keyedBy('key').occurredAt(new Date('2026-10-08T00:00:00Z'));
    await base.publish();
    await branch.publish();
    await new EventDispatcher(publisher).event(instance).publish();
    expect(publications[0].event).toBe(instance);
    expect(publications[0].event.method()).toBe(42);
    expect(publications[0].key).toBeUndefined();
    expect(publications[1].key).toBe('key');
    expect(publications[0].eventId).toBe('stable');
    expect(publications[1].eventId).toBe('stable');
    expect(publications[1].occurredAt.toISOString()).toBe('2026-10-08T00:00:00.000Z');
    expect(Object.keys(instance)).toEqual(['eventName']);
  });

  it('validates empty keys/IDs, invalid timestamps, and names', async () => {
    const { dispatch } = await load('events/event-dispatcher');
    const events = dispatch({ publish() {} });
    expect(() => events.event('')).toThrow();
    expect(() => events.event('created').keyedBy(' ')).toThrow();
    expect(() => events.event('created').with({}).withEventId('')).toThrow();
    expect(() => events.event('created').with({}).occurredAt(new Date('bad'))).toThrow();
  });

  it('defers publication, emits once on completion and composes with RxJS for each subscription', async () => {
    const { dispatch } = await load('events/event-dispatcher');
    let calls = 0;
    const builder = dispatch({ publish() { calls++; return of(1, 2, 3); } }).event('created').with({ id: '1' });
    const stream = builder.publish$().pipe(map(() => 'done'));
    expect(calls).toBe(0);
    expect(await firstValueFrom<string>(stream)).toBe('done');
    expect(calls).toBe(1);
    await builder.publish();
    await firstValueFrom(stream);
    expect(calls).toBe(3);
  });

  it('waits for Observable completion, including completion without emissions', async () => {
    const { dispatch } = await load('events/event-dispatcher');
    const source = new Subject();
    const values: unknown[] = [];
    const subscription = dispatch({ publish: () => source }).event('created').with({}).publish$().subscribe((x: unknown) => values.push(x));
    source.next('accepted');
    expect(values).toEqual([]);
    source.complete();
    expect(values).toEqual([undefined]);
    expect(subscription.closed).toBe(true);
    await expect(dispatch({ publish: () => EMPTY }).event('created').with({}).publish()).resolves.toBeUndefined();
  });

  it('propagates sync, Promise and Observable errors without retry', async () => {
    const { dispatch } = await load('events/event-dispatcher');
    const failure = new Error('offline');
    for (const publish of [() => { throw failure; }, () => Promise.reject(failure), () => throwError(() => failure)]) {
      let calls = 0;
      const builder = dispatch({ publish() { calls++; return publish(); } }).event('created').with({});
      await expect(builder.publish()).rejects.toBe(failure);
      expect(calls).toBe(1);
    }
  });

  it('publishes queued events in order, retains failures, preserves IDs across retries and ignores new events until the next drain', async () => {
    const { Entity } = await load('base-classes/entity');
    const { DomainEvent } = await load('base-classes/domain-event');
    const { dispatch } = await load('events/event-dispatcher');
    class Order extends Entity { constructor() { super({}); } }
    class Created extends DomainEvent { constructor(n: number) { super('order.created', String(n)); } }
    const order = new Order();
    const [one, two, three, later] = [1, 2, 3, 4].map(n => new Created(n));
    [one, two, three].forEach(e => order.apply(e));
    const snapshot = order.getUncommittedEvents(); snapshot.pop();
    const seen: any[] = [];
    let fail = true;
    const events = dispatch({ publish(request: any) {
      seen.push(request);
      if (request.event === one) order.apply(later);
      if (request.event === two && fail) throw new Error('partial');
    } });
    await expect(events.from(order).publish()).rejects.toThrow('partial');
    expect(order.getUncommittedEvents()).toEqual([two, three, later]);
    fail = false;
    await events.from(order).publish();
    expect(order.getUncommittedEvents()).toEqual([]);
    expect(seen.map(x => x.event)).toEqual([one, two, two, three, later]);
    expect(seen[1].eventId).toBe(seen[2].eventId);
    expect(seen[1].occurredAt).toEqual(seen[2].occurredAt);
    await events.from(order).publish(); // empty queue succeeds
  });

  it('retains queued events on cancellation and rejects concurrent drains across dispatchers', async () => {
    const { Entity } = await load('base-classes/entity');
    const { dispatch } = await load('events/event-dispatcher');
    class Order extends Entity { constructor() { super({}); } }
    const order = new Order();
    const event = { eventName: 'created', eventId: 'stable', occurredOn: new Date() };
    order.apply(event);
    let closed = 0;
    const publisher = { publish: () => new Observable(() => () => { closed++; }) };
    const stream = dispatch(publisher).from(order).publish$();
    const subscription = stream.subscribe();
    await expect(dispatch(publisher).from(order).publish()).rejects.toThrow('already');
    subscription.unsubscribe();
    expect(closed).toBe(1);
    expect(order.getUncommittedEvents()).toEqual([event]);
    await dispatch({ publish() {} }).from(order).publish();
    expect(order.getUncommittedEvents()).toEqual([]);
  });

  it('allows RxJS composition to start a new drain after successful completion', async () => {
    const { Entity } = await load('base-classes/entity');
    const { dispatch } = await load('events/event-dispatcher');
    class Order extends Entity { constructor() { super({}); } }
    const order = new Order();
    order.apply({ eventName: 'created' });
    const events = dispatch({ publish: () => EMPTY });
    await expect(firstValueFrom(events.from(order).publish$().pipe(
      concatMap(() => events.from(order).publish$()),
    ))).resolves.toBeUndefined();
  });

  it('does not release a newer reentrant drain when the previous drain finalizes', async () => {
    const { Entity } = await load('base-classes/entity');
    const { dispatch } = await load('events/event-dispatcher');
    class Order extends Entity { constructor() { super({}); } }
    const order = new Order();
    order.apply({ eventName: 'first' });
    const pending = new Subject();
    const events = dispatch({ publish: (request: any) => request.name === 'first' ? EMPTY : pending });
    const subscriptions: { unsubscribe(): void }[] = [];
    const errors: unknown[] = [];
    events.from(order).publish$().subscribe({ next() {
      order.apply({ eventName: 'second' });
      subscriptions.push(events.from(order).publish$().subscribe({ error: (error: unknown) => errors.push(error) }));
    } });
    try {
      expect(errors).toEqual([]);
      await expect(events.from(order).publish()).rejects.toThrow('already');
    } finally { subscriptions.forEach(subscription => subscription.unsubscribe()); }
  });

  it('resolves publisher and dispatcher through Nest DI and reaches a real class listener', async () => {
    const { EventDispatcher } = await load('events/event-dispatcher');
    const { EVENT_PUBLISHER_TOKEN, EVENT_DISPATCHER_TOKEN } = await load('events/event-publisher.port');
    const { EventBusEventPublisher } = await load('infrastructure/event-bus-event-publisher');
    class Created { id: string; constructor(id: string) { this.id = id; } }
    const seen: Created[] = [];
    class Listener { handle(event: Created) { seen.push(event); } }
    EventsHandler(Created)(Listener);
    const module = await Test.createTestingModule({ imports: [CqrsModule.forRoot()], providers: [
      Listener,
      { provide: EVENT_PUBLISHER_TOKEN, useFactory: (bus: EventBus) => new EventBusEventPublisher(bus, { 'order.created': (payload: any) => new Created(payload.id) }), inject: [EventBus] },
      { provide: EVENT_DISPATCHER_TOKEN, useFactory: (publisher: any) => new EventDispatcher(publisher), inject: [EVENT_PUBLISHER_TOKEN] },
    ] }).compile();
    try {
      await module.init();
      const events = module.get(EVENT_DISPATCHER_TOKEN);
      const instance = new Created('one');
      await events.event(instance).publish();
      await events.event('order.created').with({ id: 'two' }).publish();
      expect(seen[0]).toBe(instance);
      expect(seen.map(x => x.id)).toEqual(['one', 'two']);
      await expect(events.event('unmapped').with({}).publish()).rejects.toThrow('factory');
    } finally { await module.close(); }
  });

  it('encapsulates legacy Nest EventPublisher in the compatibility adapter', async () => {
    const { dispatch } = await load('events/event-dispatcher');
    const { NestEventPublisherAdapter } = await load('infrastructure/nest-event-publisher-adapter');
    class Created { readonly eventName = 'created'; }
    const seen: unknown[] = [];
    const bus = { publish(event: unknown) { seen.push(event); }, publishAll(events: unknown[]) { seen.push(...events); } };
    const adapter = new NestEventPublisherAdapter(new EventPublisher(bus as EventBus));
    const event = new Created();
    await dispatch(adapter).event(event).publish();
    expect(seen).toEqual([event]);
    expect(event).not.toBeInstanceOf(AggregateRoot);
  });

  it('records successful publications in memory and propagates a configured failure', async () => {
    const { dispatch } = await load('events/event-dispatcher');
    const { InMemoryEventPublisher } = await load('events/in-memory-event-publisher');
    const publisher = new InMemoryEventPublisher();
    await dispatch(publisher).event('created').with({ id: '1' }).publish();
    expect(publisher.publications[0].payload).toEqual({ id: '1' });
    const failing = new InMemoryEventPublisher(() => { throw new Error('unavailable'); });
    await expect(dispatch(failing).event('created').with({}).publish()).rejects.toThrow('unavailable');
    expect(failing.publications).toEqual([]);
  });

  it('maps broker envelopes and waits for transport confirmation without a live broker', async () => {
    const { dispatch } = await load('events/event-dispatcher');
    const { BrokerEventPublisher } = await load('infrastructure/broker-event-publisher');
    const envelopes: any[] = [];
    let confirm!: () => void;
    const publisher = new BrokerEventPublisher({ sendAndConfirm(envelope: unknown) {
      envelopes.push(envelope);
      return new Promise<void>(resolve => { confirm = resolve; });
    } });
    const values: unknown[] = [];
    dispatch(publisher).event('order.created').with({ id: '1' }).keyedBy('1').withEventId('event-1')
      .occurredAt(new Date('2026-10-08T00:00:00Z')).publish$().subscribe((value: unknown) => values.push(value));
    expect(envelopes).toEqual([{ destination: 'order.created', key: '1', body: '{"id":"1"}', headers: { eventId: 'event-1', occurredAt: '2026-10-08T00:00:00.000Z' } }]);
    expect(values).toEqual([]);
    confirm();
    await Promise.resolve();
    expect(values).toEqual([undefined]);
    const offline = new BrokerEventPublisher({ sendAndConfirm: async () => { throw new Error('not confirmed'); } });
    await expect(dispatch(offline).event('created').with({}).publish()).rejects.toThrow('not confirmed');
  });

  it('runs the real Order handler: persistence precedes publication and failed persistence publishes nothing', async () => {
    const { dispatch } = await load('events/event-dispatcher');
    const { CreateOrderHandler } = await import(join(TEMP, 'order/application/commands/create-order.handler.ts'));
    const { CreateOrderCommand } = await import(join(TEMP, 'order/application/commands/create-order.command.ts'));
    const order: string[] = [];
    const repository = { save: async () => { order.push('save'); } };
    const handler = new CreateOrderHandler(repository, dispatch({ publish() { order.push('publish'); } }));
    const command = new CreateOrderCommand('org', 'customer', 'Alice', [{ productId: 'p', name: 'P', quantity: 1, unitPrice: 2 }], 'BRL');
    const result = await handler.execute(command);
    expect(result.id).toBeString();
    expect(order).toEqual(['save', 'publish']);
    order.length = 0;
    repository.save = async () => { throw new Error('DB failed'); };
    await expect(handler.execute(command)).rejects.toThrow('DB failed');
    expect(order).toEqual([]);
  });

  it('runs all copied Order example specs with the new event queue', () => {
    const result = Bun.spawnSync(['node', join(ROOT, 'node_modules/vitest/vitest.mjs'), 'run', '--root', TEMP], { cwd: TEMP });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    if (result.exitCode !== 0) throw new Error(output);
    expect(result.exitCode).toBe(0);
  });
});
