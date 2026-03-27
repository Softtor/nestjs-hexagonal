# Domain Event Patterns

Domain events capture **what happened** in the domain after a state change. They are the mechanism by which aggregates communicate across boundaries without tight coupling.

## Core Principle

`entity.apply(event)` queues the event inside `AggregateRoot`. The event is NOT published immediately. The command handler is responsible for calling `publisher.mergeObjectContext(entity)` to wire the EventBus, then `entity.commit()` to publish all queued events. The entity and repository never call `commit()`.

---

## Event Class Template

Events implement `IEvent` from `@nestjs/cqrs`. Use a plain class with public readonly properties — no inheritance from a base class is required.

```typescript
// domain/events/order-placed.event.ts
import { IEvent } from '@nestjs/cqrs';

export class OrderPlacedEvent implements IEvent {
  constructor(
    /** ID of the aggregate that produced this event. */
    public readonly orderId: string,
    /** Tenant context — always include for multi-tenant systems. */
    public readonly tenantId: string,
    /** Include all data event handlers need — avoids re-fetching the entity. */
    public readonly customerId: string,
    public readonly totalAmount: number,
    public readonly placedAt: Date,
  ) {}
}
```

---

## Naming Convention

```
<Entity><PastTenseVerb>Event

OrderPlacedEvent
OrderConfirmedEvent
OrderCancelledEvent
CustomerCreatedEvent
CustomerEmailUpdatedEvent
PaymentProcessedEvent
WithdrawalApprovedEvent
```

Rules:
- Always past tense: "Created", "Updated", "Cancelled", not "Create", "Update", "Cancel"
- Include the entity name to avoid ambiguity between bounded contexts
- One event per state change — do not reuse events across different mutations

---

## Event Catalog for a Bounded Context

Document all events in one place for a BC so handlers can be discovered easily:

```typescript
// domain/events/index.ts — re-export all events from the BC
export { OrderPlacedEvent }     from './order-placed.event';
export { OrderConfirmedEvent }  from './order-confirmed.event';
export { OrderCancelledEvent }  from './order-cancelled.event';
export { OrderShippedEvent }    from './order-shipped.event';
export { OrderCompletedEvent }  from './order-completed.event';
```

---

## Event Payload Guidelines

Include in the payload everything that downstream handlers will need. This avoids handlers having to re-fetch the entity, which creates coupling and latency.

```typescript
// Good — handler gets all needed data from the event
export class CustomerCreatedEvent implements IEvent {
  constructor(
    public readonly customerId: string,
    public readonly tenantId: string,
    public readonly name: string,
    public readonly email: string | undefined,
    public readonly phone: string | undefined,
    public readonly createdAt: Date,
  ) {}
}

// Bad — handler must re-fetch the customer to know the email
export class CustomerCreatedEvent implements IEvent {
  constructor(public readonly customerId: string) {}
}
```

Exception: for large payloads (e.g., a list of line items), include only identifiers and let the handler fetch the full aggregate once via repository.

---

## Applying Events in Entity Methods

```typescript
// Inside the entity class:

static create(input: CreateOrderInput, id?: string): OrderEntity {
  const entity = new OrderEntity(
    { ...input, status: OrderStatusVO.pending(), createdAt: new Date() },
    id,
  );
  // apply() queues the event — does NOT publish it
  entity.apply(
    new OrderPlacedEvent(
      entity.id,
      entity.tenantId,
      entity.customerId,
      entity.totalAmount,
      entity.createdAt,
    ),
  );
  return entity;
}

confirm(): void {
  this.props.status = this.props.status.transitionTo(OrderStatusEnum.CONFIRMED);
  this.props.confirmedAt = new Date();
  this.touch();
  this.apply(
    new OrderConfirmedEvent(this.id, this.tenantId, this.props.confirmedAt),
  );
}
```

---

## Handler Template

Event handlers react to domain events and produce side effects. They live in `infrastructure/listeners/`.

```typescript
// infrastructure/listeners/order-placed.handler.ts
import { Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { OrderPlacedEvent } from '../../domain/events/order-placed.event';

@EventsHandler(OrderPlacedEvent)
export class OrderPlacedHandler implements IEventHandler<OrderPlacedEvent> {
  private readonly logger = new Logger(OrderPlacedHandler.name);

  constructor(
    // inject ports for side effects: RabbitMQ publisher, Redis, notification service, etc.
  ) {}

  async handle(event: OrderPlacedEvent): Promise<void> {
    this.logger.log(`Order placed: ${event.orderId}`);
    // side effects:
    //   - publish integration event to RabbitMQ
    //   - update Redis read model
    //   - send notification
    //   - trigger downstream pipeline
  }
}
```

Rules for handlers:
- Use `@EventsHandler` + `IEventHandler` — never `@OnEvent` for new code
- `handle()` can be `async` — errors are caught by the EventBus
- Inject only infrastructure ports (never the Prisma repository directly — inject the repository port)
- Register the handler in the module's `providers` array

---

## Testing Domain Events on Entities

Verify that the correct events are queued after entity operations:

```typescript
// domain/entities/__tests__/unit/order.entity.spec.ts
import { describe, it, expect } from 'vitest';
import { OrderEntity } from '../../order.entity';
import { OrderDataBuilder } from '../../../testing/helpers/order.data-builder';
import { OrderPlacedEvent } from '../../../events/order-placed.event';
import { OrderConfirmedEvent } from '../../../events/order-confirmed.event';

describe('OrderEntity — domain events', () => {
  it('create() should queue OrderPlacedEvent', () => {
    const order = OrderEntity.create(OrderDataBuilder());
    const events = order.getUncommittedEvents();

    expect(events).toHaveLength(1);
    expect(events[0]).toBeInstanceOf(OrderPlacedEvent);

    const event = events[0] as OrderPlacedEvent;
    expect(event.orderId).toBe(order.id);
    expect(event.tenantId).toBe(order.tenantId);
  });

  it('restore() should queue no events', () => {
    const order = OrderEntity.restore(
      { ...OrderDataBuilder(), status: OrderStatusVO.pending(), createdAt: new Date() },
      faker.string.uuid(),
    );
    expect(order.getUncommittedEvents()).toHaveLength(0);
  });

  it('confirm() should queue OrderConfirmedEvent', () => {
    const order = OrderEntity.create(OrderDataBuilder());
    order.commit(); // clear creation event

    order.confirm();

    const events = order.getUncommittedEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toBeInstanceOf(OrderConfirmedEvent);
  });

  it('multiple mutations queue multiple events', () => {
    const order = OrderEntity.create(OrderDataBuilder());
    // After create: 1 event (OrderPlacedEvent)

    order.confirm();
    // Now: 2 events

    const events = order.getUncommittedEvents();
    expect(events).toHaveLength(2);
    expect(events[0]).toBeInstanceOf(OrderPlacedEvent);
    expect(events[1]).toBeInstanceOf(OrderConfirmedEvent);
  });
});
```

Key methods on `AggregateRoot`:
- `entity.getUncommittedEvents()` — read queued events without clearing
- `entity.commit()` — publish events to EventBus and clear the queue
- Use `entity.commit()` in tests when you want to reset the event queue between operations

---

## Domain Events vs Integration Events

Domain events and integration events serve different purposes and have different visibility rules.

### Domain Events — INTERNAL to the BC

Domain events are produced by aggregates via `entity.apply()` and published to the in-process `EventBus` via `entity.commit()`. They are **private** to the bounded context that emits them.

```
OrderBC:
  OrderEntity.pay()          → applies OrderPaidEvent
  command handler             → entity.commit() publishes to EventBus
  OrderPaidProjectionHandler ← same-BC listener (Redis read model)
  OrderPaidAuditHandler      ← same-BC listener (audit log)
```

**Rules:**
- Domain events never leave the bounded context directly
- Other BCs must NOT subscribe to domain events from a foreign BC via `@EventsHandler`
- Domain events may contain rich domain types (VOs, enums) — they are internal

### Integration Events — PUBLIC contract between BCs

When a domain event needs to trigger a reaction in another BC, a dedicated handler publishes an **integration event** via a port. The port is defined by the emitting BC and implemented by the consuming BC (ACL).

```
OrderBC:
  OrderPaidEvent (domain) → OrderPaidIntegrationHandler
                              → integrationEventsPort.orderPaid(primitives)
                                                    ↓ (port/adapter boundary)
InvoicingBC:
  OrderIntegrationEventsAdapter (ACL)
    → CreateInvoiceCommand (own BC)
```

**Rules:**
- Integration event payloads use **primitive types only** — no domain objects
- The emitting BC defines the port; the consuming BC implements the adapter
- The emitting BC NEVER imports from the consuming BC
- The ACL adapter in the consuming BC is the only place that knows both models

### A domain event handler can publish an integration event

```typescript
// This handler lives in the EMITTING BC (Orders)
// It converts a domain event into a call to the integration port
@EventsHandler(OrderPaidEvent)
export class OrderPaidIntegrationHandler implements IEventHandler<OrderPaidEvent> {
  constructor(
    @Inject(ORDER_INTEGRATION_EVENTS_TOKEN)
    private readonly integrationEvents: OrderIntegrationEventsPort,
  ) {}

  async handle(event: OrderPaidEvent): Promise<void> {
    // Publish integration event — payload is primitives only
    await this.integrationEvents.orderPaid({
      orderId: event.aggregateId,
      organizationId: event.organizationId,
      customerId: event.customerId,
      total: event.total,
      currency: event.currency,
    });
  }
}
```

### Deployment context determines the transport

| Context | Integration mechanism |
|---|---|
| Modular monolith | Integration Event Port + ACL adapter (in-process, type-safe) |
| Microservices | Message broker (RabbitMQ/Kafka) — port wraps the publisher |

In both cases, the emitting BC defines a port. Only the adapter implementation changes — the handler and port stay the same.

See `skills/event-listeners/references/cross-bc-listeners.md` for full templates.
