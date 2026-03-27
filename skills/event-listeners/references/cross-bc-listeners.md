# Cross-BC Listeners

Communication between bounded contexts uses the **Integration Event Port** pattern with an **Anti-Corruption Layer (ACL)**. Direct CommandBus dispatch from a listener in BC A into BC B creates implicit coupling — avoid it.

---

## Why Direct CommandBus Dispatch Is Wrong

```typescript
// WRONG — BC A's listener imports BC B's command
import { CreateInvoiceCommand } from '@/enterprise/invoicing/application/commands/create-invoice.command';

@EventsHandler(OrderPaidEvent)
export class OrderPaidInvoiceHandler {
  constructor(private readonly commandBus: CommandBus) {}

  async handle(event: OrderPaidEvent): Promise<void> {
    // This creates a dependency: Orders BC → Invoicing BC
    await this.commandBus.execute(new CreateInvoiceCommand(...));
  }
}
```

**Problems:**
- Orders BC now knows Invoicing BC exists — coupling in the wrong direction
- Changing `CreateInvoiceCommand` requires touching Orders BC
- Import graph becomes a spider web as the system grows
- The "consuming BC imports event from emitting BC" is fine; the reverse is not

---

## The Correct Pattern: Integration Event Port + ACL

**Key principle:** BC A defines a port (interface). BC B implements it as an adapter (ACL). BC A NEVER imports from BC B.

### Step 1 — Define the port in the emitting BC

```typescript
// orders/application/ports/order-integration-events.port.ts
export const ORDER_INTEGRATION_EVENTS_TOKEN = Symbol('OrderIntegrationEvents');

export interface OrderIntegrationEventsPort {
  // One method per integration event — payload uses primitive types, not domain objects
  orderPaid(payload: {
    orderId: string;
    organizationId: string;
    customerId: string;
    total: number;
    currency: string;
  }): Promise<void>;

  orderCancelled(payload: {
    orderId: string;
    organizationId: string;
    reason: string;
  }): Promise<void>;
}
```

**Rules for the port:**
- Lives in `application/ports/` of the emitting BC
- Payload uses primitive types only — no domain objects that would create transitive imports
- One method per integration event
- Async — cross-BC side effects may involve I/O

### Step 2 — Publish via the port in a domain event handler

```typescript
// orders/infrastructure/listeners/order-paid-integration.handler.ts
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { Inject, Logger } from '@nestjs/common';

import { OrderPaidEvent } from '../../domain/events/order-paid.event';
import {
  ORDER_INTEGRATION_EVENTS_TOKEN,
  type OrderIntegrationEventsPort,
} from '../../application/ports/order-integration-events.port';

@EventsHandler(OrderPaidEvent)
export class OrderPaidIntegrationHandler implements IEventHandler<OrderPaidEvent> {
  private readonly logger = new Logger(OrderPaidIntegrationHandler.name);

  constructor(
    @Inject(ORDER_INTEGRATION_EVENTS_TOKEN)
    private readonly integrationEvents: OrderIntegrationEventsPort,
  ) {}

  async handle(event: OrderPaidEvent): Promise<void> {
    try {
      await this.integrationEvents.orderPaid({
        orderId: event.aggregateId,
        organizationId: event.organizationId,
        customerId: event.customerId,
        total: event.total,
        currency: event.currency,
      });
    } catch (error) {
      this.logger.error(
        `Failed to publish order.paid integration event for ${event.aggregateId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
```

### Step 3 — Implement the ACL adapter in the consuming BC

```typescript
// invoicing/infrastructure/adapters/order-integration-events.adapter.ts
import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

// The consuming BC imports the PORT (interface) — not the emitting BC's internals
import { type OrderIntegrationEventsPort } from '@/enterprise/orders/application/ports/order-integration-events.port';

// The consuming BC's own command
import { CreateInvoiceCommand } from '../../application/commands/create-invoice.command';
import { CancelInvoiceCommand } from '../../application/commands/cancel-invoice.command';

@Injectable()
export class OrderIntegrationEventsAdapter implements OrderIntegrationEventsPort {
  constructor(private readonly commandBus: CommandBus) {}

  async orderPaid(payload: {
    orderId: string;
    organizationId: string;
    customerId: string;
    total: number;
    currency: string;
  }): Promise<void> {
    // ACL: translate Orders BC model → Invoicing BC model
    await this.commandBus.execute(
      new CreateInvoiceCommand(
        payload.organizationId,
        payload.orderId,
        payload.customerId,
        payload.total,
        payload.currency,
      ),
    );
  }

  async orderCancelled(payload: {
    orderId: string;
    organizationId: string;
    reason: string;
  }): Promise<void> {
    await this.commandBus.execute(
      new CancelInvoiceCommand(payload.organizationId, payload.orderId, payload.reason),
    );
  }
}
```

---

## Module Wiring

### Emitting BC module

The emitting BC module provides the token and accepts the adapter class from outside:

```typescript
// orders/orders.module.ts
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { ORDER_INTEGRATION_EVENTS_TOKEN } from './application/ports/order-integration-events.port';
import { OrderPaidIntegrationHandler } from './infrastructure/listeners/order-paid-integration.handler';

@Module({
  imports: [CqrsModule],
  providers: [
    OrderPaidIntegrationHandler,
    // Token is provided by the consuming module via forFeature / dynamic module,
    // or wired in the root AppModule:
    // { provide: ORDER_INTEGRATION_EVENTS_TOKEN, useClass: OrderIntegrationEventsAdapter }
  ],
  exports: [ORDER_INTEGRATION_EVENTS_TOKEN],
})
export class OrdersModule {}
```

### Root wiring (AppModule or feature module)

```typescript
// app.module.ts
import { OrdersModule } from './enterprise/orders/orders.module';
import { InvoicingModule } from './enterprise/invoicing/invoicing.module';
import { ORDER_INTEGRATION_EVENTS_TOKEN } from './enterprise/orders/application/ports/order-integration-events.port';
import { OrderIntegrationEventsAdapter } from './enterprise/invoicing/infrastructure/adapters/order-integration-events.adapter';

@Module({
  imports: [OrdersModule, InvoicingModule],
  providers: [
    {
      provide: ORDER_INTEGRATION_EVENTS_TOKEN,
      useClass: OrderIntegrationEventsAdapter,
    },
  ],
})
export class AppModule {}
```

---

## The 3 Approaches

| Approach | Coupling | Type Safety | When to Use |
|---|---|---|---|
| **Integration Event Port** (this file) | Low — port-based | Full | Modular monolith — recommended |
| **String events (EventEmitter2)** | Low | None (string keys) | Quick prototypes or simple fan-out |
| **Message broker (RabbitMQ/Kafka)** | Minimal | Via schema/Zod | Microservices or async durability needed |

### String events (EventEmitter2) — simpler but no type-safety

```typescript
// Emitter BC
this.eventEmitter.emit('order.paid', { orderId, organizationId, total, currency });

// Consumer BC — subscribes by string key
@OnEvent('order.paid')
async handleOrderPaid(payload: { orderId: string; /* ... */ }): Promise<void> {
  await this.commandBus.execute(new CreateInvoiceCommand(...));
}
```

**When to choose:** Small team, few BCs, speed over correctness. The key `'order.paid'` is a runtime string — no compile-time safety.

---

## Testing

### Test the publisher handler

```typescript
describe('OrderPaidIntegrationHandler', () => {
  let handler: OrderPaidIntegrationHandler;
  let integrationEvents: { orderPaid: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    integrationEvents = { orderPaid: vi.fn().mockResolvedValue(undefined) };
    handler = new OrderPaidIntegrationHandler(integrationEvents as OrderIntegrationEventsPort);
  });

  it('should call orderPaid with correct payload', async () => {
    const event = new OrderPaidEvent('order-1', 'org-1', 'customer-1', 500, 'BRL');

    await handler.handle(event);

    expect(integrationEvents.orderPaid).toHaveBeenCalledWith({
      orderId: 'order-1',
      organizationId: 'org-1',
      customerId: 'customer-1',
      total: 500,
      currency: 'BRL',
    });
  });

  it('should not throw when integration port fails', async () => {
    integrationEvents.orderPaid.mockRejectedValue(new Error('downstream down'));
    const event = new OrderPaidEvent('order-1', 'org-1', 'customer-1', 500, 'BRL');

    await expect(handler.handle(event)).resolves.toBeUndefined();
  });
});
```

### Test the ACL adapter

```typescript
describe('OrderIntegrationEventsAdapter', () => {
  let adapter: OrderIntegrationEventsAdapter;
  let commandBus: { execute: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    commandBus = { execute: vi.fn().mockResolvedValue(undefined) };
    adapter = new OrderIntegrationEventsAdapter(commandBus as unknown as CommandBus);
  });

  it('should dispatch CreateInvoiceCommand with translated payload', async () => {
    await adapter.orderPaid({
      orderId: 'order-1',
      organizationId: 'org-1',
      customerId: 'customer-1',
      total: 500,
      currency: 'BRL',
    });

    expect(commandBus.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        orderId: 'order-1',
        customerId: 'customer-1',
        total: 500,
        currency: 'BRL',
      }),
    );
  });
});
```

---

## Anti-Patterns

```
WRONG: Orders BC imports Invoicing command
  orders/infrastructure/listeners/order-paid.handler.ts
    import { CreateInvoiceCommand } from '@/enterprise/invoicing/...'  ← coupling

WRONG: Orders BC imports Invoicing service
  orders/infrastructure/listeners/order-paid.handler.ts
    import { InvoiceService } from '@/enterprise/invoicing/...'  ← coupling

WRONG: EventsHandler in emitting BC dispatches cross-BC command directly via CommandBus
  — CommandBus is global, so the command will be routed to the wrong handler at runtime

CORRECT: Orders BC defines port → Invoicing BC implements adapter → wired at app root
```
