# Fluent event dispatcher

Copy the templates in `shared/events/` and `shared/infrastructure/` into your application. These are copyable source files, not a runtime package. The domain keeps pure TypeScript entities and events; the application dispatcher uses RxJS, and infrastructure adapters own NestJS and transport SDKs.

The fluent entry point is inspired by the [tech-challenge dispatcher](https://github.com/jvtuta/tech-challenge/blob/develop/packages/messaging/src/event-dispatch.ts). The copied templates are tested with TypeScript 5.9.3, RxJS 7.8.2 and NestJS CQRS 11.0.3. Install RxJS 7 in the consuming application; NestJS is required only for the Nest infrastructure adapters.

## Fluent API and types

```typescript
import { dispatch, EventDispatcher } from '@/shared/events/event-dispatcher';
import type { EventPublisherPort } from '@/shared/events/event-publisher.port';

type OrderEvents = {
  'order.created': { orderId: string; total: number };
};

const events = dispatch<OrderEvents>(publisher);
await events.event('order.created').with({ orderId, total }).keyedBy(orderId).publish();
await events.event(new OrderCreatedEvent(orderId, total)).publish();
```

`dispatch<Events>(publisher)` and `new EventDispatcher<Events>(publisher)` have the same behavior. A named event requires `.with(payload)` with the payload type selected by its name. An instance already contains its payload and has no `.with()`. The original instance and prototype reach the publisher unchanged.

Builders are immutable. `.keyedBy(key)`, `.withEventId(id)` and `.occurredAt(date)` return a configured builder without mutating the event. Domain events supply stable `eventName`, `aggregateId`, `eventId` and `occurredOn` metadata. For events without metadata, reuse a configured builder or explicitly supply the same identifier and date when repeating an uncertain delivery. Keys are optional; a transport that requires a key must validate an explicit key or derive it through adapter configuration.

`publish()` returns `Promise<void>`. `publish$()` returns a cold `Observable<void>`: construction has no effect, and each subscription starts a publication.

```typescript
import { concatMap } from 'rxjs';

orders$.pipe(
  concatMap((order) => events.event(new OrderCreatedEvent(order.id, order.total)).publish$()),
).subscribe({ error: (error) => reportPublicationFailure(error) });
```

The port accepts synchronous completion, `Promise<unknown>` or `Observable<unknown>`. An Observable publisher must complete; completion without an emission also succeeds. Errors propagate and there is no automatic retry. Unsubscribing does not guarantee broker cancellation; delivery may have occurred before a failure or cancellation was observed.

## Entity queue and transaction ordering

`Entity.apply(event)` queues locally. `getUncommittedEvents()` returns a snapshot. `acknowledgeEvent(event)` removes one queued entry; the dispatcher performs that acknowledgement only after the publisher succeeds.

```typescript
const order = await unitOfWork.transaction(async (repository) => {
  const entity = useCase.execute(input); // pure logic returns the entity
  await repository.save(entity);
  return entity;
}); // resolves only after the database transaction actually commits
await events.from(order).publish();
```

If a use case persists through a repository port, it still returns the entity and never publishes. Repositories perform persistence only. With an ambient transaction, publishing immediately after `save()` is too early: wait for the owning transaction to commit first.

`from(entity).publish()` publishes the initial snapshot sequentially. It acknowledges each successful entry, stops at the first failure and retains that event and all following events. New entries added during publication remain queued for a later call. Do not overlap publication of the same entity; the dispatcher rejects concurrent draining. Persistence failure prevents publication. Successful persistence followed by failed publication does not roll back the stored aggregate: use an outbox when durable coordination is required.

## Container configuration

Publisher providers use `EVENT_PUBLISHER_TOKEN`. Handlers inject `EVENT_DISPATCHER_TOKEN`; a factory constructs the dispatcher with the publisher selected by the module.

```typescript
import { Inject, Module } from '@nestjs/common';
import { CqrsModule, EventBus } from '@nestjs/cqrs';
import { dispatch, EventDispatcher } from '@/shared/events/event-dispatcher';
import { EVENT_DISPATCHER_TOKEN, EVENT_PUBLISHER_TOKEN } from '@/shared/events/event-publisher.port';
import type { EventPublisherPort } from '@/shared/events/event-publisher.port';
import { EventBusEventPublisher } from '@/shared/infrastructure/event-bus-event-publisher';

@Module({
  imports: [CqrsModule],
  providers: [
    {
      provide: EVENT_PUBLISHER_TOKEN,
      inject: [EventBus],
      useFactory: (bus: EventBus) => new EventBusEventPublisher(bus, {
        'order.created': (payload: unknown) => {
          const data = payload as OrderEvents['order.created']; // validate if received externally
          return new OrderCreatedEvent(data.orderId, data.total);
        },
      }),
    },
    {
      provide: EVENT_DISPATCHER_TOKEN,
      inject: [EVENT_PUBLISHER_TOKEN],
      useFactory: (publisher: EventPublisherPort) => dispatch<OrderEvents>(publisher),
    },
    CreateOrderHandler,
    OrderCreatedListener,
  ],
  exports: [EVENT_DISPATCHER_TOKEN],
})
export class OrderModule {}

// In the command handler constructor:
// @Inject(EVENT_DISPATCHER_TOKEN) private readonly events: EventDispatcher<OrderEvents>
```

For a configured injectable publisher class, replace the publisher factory with `{ provide: EVENT_PUBLISHER_TOKEN, useClass: KafkaEventPublisher }`. To reuse an existing provider, register `KafkaEventPublisher` and use `{ provide: EVENT_PUBLISHER_TOKEN, useExisting: KafkaEventPublisher }`. Its constructor dependencies are resolved by NestJS. The dispatcher factory stays the same; there is no global publisher or hidden container lookup.

## Publisher request and adapters

`EventPublication` discriminates `kind: 'named'` with `payload` from `kind: 'instance'` with `event`. Both variants contain `name`, `eventId`, `occurredAt: Date` and optional `key`. `EventPublisherPort.publish(request)` returns `void | Promise<unknown> | Observable<unknown>`.

`EventBusEventPublisher` forwards an instance unchanged to NestJS CQRS so existing `@EventsHandler(EventClass)` listeners keep class routing. Named events need explicit name-to-class factories; a missing factory errors rather than silently dropping class routing. Bus success means handoff, not completion of listeners.

`InMemoryEventPublisher` records normalized publications for tests. Use it with the real dispatcher to assert saved state exists before publication, no publication follows persistence failure, and failure retains the pending queue.

A broker adapter maps this request to its transport envelope and owns acknowledgement. The tested `shared/infrastructure/broker-event-publisher.ts.example` provides this mapping and an infrastructure-only `BrokerTransport.sendAndConfirm()` contract:

```typescript
class BrokerEventPublisher implements EventPublisherPort {
  constructor(private readonly transport: BrokerTransport) {}

  async publish(request: EventPublication): Promise<void> {
    const payload = request.kind === 'named' ? request.payload : request.event;
    await this.transport.sendAndConfirm({
      destination: request.name,
      key: request.key,
      body: JSON.stringify(payload),
      headers: {
        eventId: request.eventId,
        occurredAt: request.occurredAt.toISOString(),
      },
    });
  }
}
```

`BrokerTransport` is an infrastructure contract you implement for your client. In Kafka map the destination to a topic, key to the record key, body to the serialized value and headers to your envelope; complete on the configured producer acknowledgement. In RabbitMQ map the destination to an exchange/routing key, identifier to `messageId`, date to the timestamp/envelope and body to the content; use publisher confirms. Neither broker client nor SDK types belong in the entity, dispatcher or port. Broker confirmation does not confirm consumer processing.

## Migration compatibility

Replace entities extending NestJS `AggregateRoot` with the pure `Entity` template and events implementing NestJS `IEvent` with the pure `DomainEvent` template or equivalent metadata. Replace handler `publisher.mergeObjectContext(entity); entity.commit();` with `await events.from(entity).publish()` after the real transaction commit. Inject the dispatcher token, configure a publisher provider and retain `@EventsHandler` listeners through the EventBus adapter.

The `NestEventPublisherAdapter` template is infrastructure compatibility for a legacy NestJS `EventPublisher` / `AggregateRoot` wrapper. Keep that wrapper inside infrastructure; it is not the domain base or the preferred new handler flow. Existing projects may retain their old flow while migrating, and the checker recognizes that compatibility. Updating the plugin does not rewrite templates previously copied into an application.

Delivery is not exactly once. No persistent retries or outbox are included. Failures and cancellation can leave delivery uncertain; preserve stable identifiers and make consumers tolerate duplicate deliveries when repeating publication.
