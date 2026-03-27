---
name: event-listeners
description: Use when creating event listeners that react to domain events — same-BC side effects (projections, audit, cache), cross-BC reactions (another bounded context consuming events), or bridge listeners (WebSocket broadcast, RabbitMQ publish, email). Covers listener taxonomy, placement rules, Strategy+Gateway pattern for fan-out, and anti-over-engineering criteria.
argument-hint: Event and type (e.g., "OrderCreatedEvent broadcast", "cross-bc OrderPaid", "projection Order")
---

# Event Listeners

Domain events emitted via `entity.commit()` flow through the NestJS CQRS `EventBus`. Listeners are `@EventsHandler` classes that react to these events. Multiple handlers for the same event run in parallel via `Promise.allSettled` — if one fails, others continue.

This skill covers WHERE listeners live, WHAT they do, and WHEN you actually need one.

---

## Decision Tree

```
Do you need to react to a domain event?
│
├─ Is it a side effect within the SAME bounded context?
│  └─ YES → Same-BC Listener (see Section 1)
│     Examples: update Redis projection, write audit log, invalidate cache
│
├─ Does ANOTHER bounded context need to react?
│  └─ YES → Cross-BC Listener (see Section 2)
│     Examples: Billing creates invoice when Order is created
│
├─ Does the event need to leave the process?
│  └─ YES → Bridge Listener (see Section 3)
│     Examples: WebSocket broadcast, RabbitMQ publish, send email, call webhook
│
└─ Is the side effect simple and only 1 consumer exists?
   └─ YES → Consider putting it in the command handler directly (no listener needed)
```

---

## When NOT to Create a Listener (anti-over-engineering)

| Situation | Do this instead |
|---|---|
| Only 1 side effect, simple and synchronous | Put it in the command handler after `entity.commit()` |
| Side effect is part of the core business transaction | Keep it in the use case / handler — not a separate listener |
| < 2 consumers for the event | Question whether you need the event at all |
| Event payload identical to what listener would emit | Emit directly from handler, skip intermediate event |

**Principle:** Events are for decoupling. If there's nothing to decouple, don't add the indirection.

---

## Section 1: Same-BC Listener

Lives in `<bc>/infrastructure/listeners/`. Reacts to events from its OWN bounded context.

```typescript
// infrastructure/listeners/order-created-projection.handler.ts
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { Inject, Logger } from '@nestjs/common';

import { OrderCreatedEvent } from '../../domain/events/order-created.event';
import { REDIS_READ_MODEL_TOKEN } from '../../application/ports/read-model.port';
import type { ReadModelPort } from '../../application/ports/read-model.port';

@EventsHandler(OrderCreatedEvent)
export class OrderCreatedProjectionHandler implements IEventHandler<OrderCreatedEvent> {
  private readonly logger = new Logger(OrderCreatedProjectionHandler.name);

  constructor(
    @Inject(REDIS_READ_MODEL_TOKEN)
    private readonly readModel: ReadModelPort,
  ) {}

  async handle(event: OrderCreatedEvent): Promise<void> {
    try {
      await this.readModel.upsert(`order:${event.aggregateId}`, {
        id: event.aggregateId,
        total: event.total,
        status: event.status,
        organizationId: event.organizationId,
        updatedAt: event.occurredOn.toISOString(),
      });
    } catch (error) {
      // Log but never re-throw — don't break the event chain
      this.logger.error(`[OrderCreatedProjection] Failed:`, error);
    }
  }
}
```

**Common same-BC listeners:**
- **Projection updater** — writes denormalized view to Redis/MongoDB
- **Audit log** — records domain change for compliance
- **Cache invalidation** — clears stale cache entries
- **Counter update** — increments/decrements aggregate counters

See `references/same-bc-listeners.md` for full templates.

---

## Section 2: Cross-BC Listener

Lives in the **CONSUMING** bounded context, NOT the emitting one. This is the most important placement rule.

```
OrderBC emits OrderCreatedEvent
  → BillingBC has OrderCreatedInvoiceHandler in billing/infrastructure/listeners/
  → NotificationBC has OrderCreatedNotifyHandler in notification/infrastructure/listeners/
```

**Importing events cross-BC is safe** because events are immutable value objects with no transitive dependencies:

```typescript
// billing/infrastructure/listeners/order-created-invoice.handler.ts
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { CommandBus } from '@nestjs/cqrs';

// Import event from emitting BC — safe, events are pure data
import { OrderCreatedEvent } from '@/enterprise/orders/domain/events/order-created.event';

// Import own command
import { CreateInvoiceCommand } from '../../application/commands/create-invoice.command';

@EventsHandler(OrderCreatedEvent)
export class OrderCreatedInvoiceHandler implements IEventHandler<OrderCreatedEvent> {
  private readonly logger = new Logger(OrderCreatedInvoiceHandler.name);

  constructor(private readonly commandBus: CommandBus) {}

  async handle(event: OrderCreatedEvent): Promise<void> {
    try {
      // Cross-BC listener dispatches a COMMAND in its own BC
      await this.commandBus.execute(
        new CreateInvoiceCommand(
          event.organizationId,
          event.aggregateId,  // orderId
          event.total,
        ),
      );
    } catch (error) {
      this.logger.error(`[OrderCreatedInvoice] Failed to create invoice:`, error);
    }
  }
}
```

**Key rules for cross-BC listeners:**
1. Listener lives in the CONSUMING BC's `infrastructure/listeners/`
2. Import the event class directly — no shared events module needed
3. Listener dispatches a COMMAND in its own BC — never calls another BC's service directly
4. try/catch mandatory — cross-BC failure must not affect emitting BC
5. Register the listener in the CONSUMING BC's module providers

See `references/cross-bc-listeners.md` for full patterns.

---

## Section 3: Bridge Listener

Transforms a domain event into an external output: WebSocket broadcast, RabbitMQ message, email, webhook.

```typescript
// infrastructure/listeners/order-created-broadcast.handler.ts
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { Inject, Logger } from '@nestjs/common';

import { OrderCreatedEvent } from '../../domain/events/order-created.event';
import { WS_GATEWAY_TOKEN, type WsGatewayPort } from '@/shared/ports/ws-gateway.port';

@EventsHandler(OrderCreatedEvent)
export class OrderCreatedBroadcastHandler implements IEventHandler<OrderCreatedEvent> {
  private readonly logger = new Logger(OrderCreatedBroadcastHandler.name);

  constructor(
    @Inject(WS_GATEWAY_TOKEN) private readonly gateway: WsGatewayPort,
  ) {}

  async handle(event: OrderCreatedEvent): Promise<void> {
    try {
      this.gateway.emitToOrganization(event.organizationId, 'order:created', {
        id: event.aggregateId,
        total: event.total,
        status: event.status,
      });
    } catch (error) {
      this.logger.error(`[OrderCreatedBroadcast] Failed:`, error);
    }
  }
}
```

**Bridge types:**
- **WebSocket** — `WsGatewayPort.emitToOrganization()` (see `websocket-broadcasting` skill)
- **Message broker** — publish to RabbitMQ/Kafka exchange for microsservice consumption
- **Email** — send via `EmailPort` (notification listeners)
- **Webhook** — POST to external URL via `HttpPort`

See `references/bridge-listeners.md` for full templates.

---

## Strategy + Gateway Pattern (3+ consumers)

When 3+ listeners react to the same event and share pre-processing (validation, enrichment), use the Gateway pattern with Strategy fan-out.

**When to use:** 3+ consumers for the same event that share common logic.
**When NOT to use:** < 3 consumers — separate handlers are simpler.

```typescript
// Interface for listener strategies
export interface EventListenerStrategy<T> {
  supports(event: T): boolean;
  execute(event: T): Promise<void>;
}

// Gateway handler — single @EventsHandler, fans out to strategies
@EventsHandler(OrderCreatedEvent)
export class OrderCreatedGateway implements IEventHandler<OrderCreatedEvent> {
  private readonly logger = new Logger(OrderCreatedGateway.name);

  constructor(
    @Inject('ORDER_CREATED_STRATEGIES')
    private readonly strategies: EventListenerStrategy<OrderCreatedEvent>[],
  ) {}

  async handle(event: OrderCreatedEvent): Promise<void> {
    const applicable = this.strategies.filter(s => s.supports(event));

    const results = await Promise.allSettled(
      applicable.map(strategy => strategy.execute(event)),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.error(`[OrderCreatedGateway] Strategy failed:`, result.reason);
      }
    }
  }
}

// Strategy implementations
@Injectable()
export class OrderProjectionStrategy implements EventListenerStrategy<OrderCreatedEvent> {
  supports(): boolean { return true; }
  async execute(event: OrderCreatedEvent): Promise<void> { /* update Redis */ }
}

@Injectable()
export class OrderBroadcastStrategy implements EventListenerStrategy<OrderCreatedEvent> {
  supports(): boolean { return true; }
  async execute(event: OrderCreatedEvent): Promise<void> { /* WS emit */ }
}

@Injectable()
export class OrderInvoiceStrategy implements EventListenerStrategy<OrderCreatedEvent> {
  supports(event: OrderCreatedEvent): boolean {
    return event.total > 0;  // Only for paid orders
  }
  async execute(event: OrderCreatedEvent): Promise<void> { /* create invoice */ }
}

// Module wiring
{
  provide: 'ORDER_CREATED_STRATEGIES',
  useFactory: (
    projection: OrderProjectionStrategy,
    broadcast: OrderBroadcastStrategy,
    invoice: OrderInvoiceStrategy,
  ): EventListenerStrategy<OrderCreatedEvent>[] => [projection, broadcast, invoice],
  inject: [OrderProjectionStrategy, OrderBroadcastStrategy, OrderInvoiceStrategy],
}
```

**Benefits over separate handlers:**
- Centralized error isolation (`Promise.allSettled`)
- Shared pre-processing (fetch once, pass to all)
- Dynamic enable/disable via `supports()`
- Single `@EventsHandler` registration per event

**Trade-off:** More indirection. Only use when the benefits outweigh the simplicity of separate handlers.

---

## Listener Registration

All listeners are registered in the CONSUMING module's `providers` array:

```typescript
// In the module that CONSUMES the event
@Module({
  imports: [CqrsModule],
  providers: [
    // Same-BC listeners
    OrderCreatedProjectionHandler,
    OrderUpdatedCacheInvalidator,

    // Cross-BC listeners (events imported from other BCs)
    PaymentReceivedInvoiceHandler,

    // Bridge listeners
    OrderCreatedBroadcastHandler,

    // Strategy gateway (if using Strategy pattern)
    OrderCreatedGateway,
    OrderProjectionStrategy,
    OrderBroadcastStrategy,
    OrderInvoiceStrategy,
    {
      provide: 'ORDER_CREATED_STRATEGIES',
      useFactory: (...strategies) => strategies,
      inject: [OrderProjectionStrategy, OrderBroadcastStrategy, OrderInvoiceStrategy],
    },
  ],
})
export class OrdersModule {}
```

---

## Testing Listeners

```typescript
describe('OrderCreatedProjectionHandler', () => {
  let handler: OrderCreatedProjectionHandler;
  let readModel: MockReadModelPort;

  beforeEach(() => {
    readModel = { upsert: vi.fn(), get: vi.fn(), delete: vi.fn() };
    handler = new OrderCreatedProjectionHandler(readModel);
  });

  it('should update read model on order created', async () => {
    const event = new OrderCreatedEvent('order-1', 'org-1', 1000, 'PENDING');

    await handler.handle(event);

    expect(readModel.upsert).toHaveBeenCalledWith('order:order-1', {
      id: 'order-1',
      total: 1000,
      status: 'PENDING',
      organizationId: 'org-1',
      updatedAt: expect.any(String),
    });
  });

  it('should not throw on read model failure', async () => {
    readModel.upsert.mockRejectedValue(new Error('Redis down'));
    const event = new OrderCreatedEvent('order-1', 'org-1', 1000, 'PENDING');

    // Must not throw
    await expect(handler.handle(event)).resolves.toBeUndefined();
  });
});
```

---

## References

| File | Content |
|------|---------|
| `references/same-bc-listeners.md` | Projection updater, audit log, cache invalidation, counter update |
| `references/cross-bc-listeners.md` | Event import rules, CommandBus dispatch, module wiring, circular dep avoidance |
| `references/bridge-listeners.md` | WS broadcast, RabbitMQ publish, email notification, webhook POST |
