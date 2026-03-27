# Example: Orders Bounded Context

A complete, concrete example of a NestJS bounded context using Hexagonal Architecture + DDD + CQRS.
The domain is an e-commerce **Orders** context — placing orders, tracking status, and cancelling.

## What this example covers

- Entity with domain events (`OrderEntity` extends `AggregateRoot`)
- Value object state machine (`OrderStatusVO` — five states, controlled transitions)
- Composed value object (`MoneyVO` — amount + currency, add operation)
- Domain event classes (`OrderCreatedEvent`, `OrderPaidEvent`, `OrderCancelledEvent`, `OrderItemAddedEvent`)
- Domain errors with context (`OrderNotFoundError`, `InvalidOrderStatusTransitionError`)
- Repository interface with typed filter (namespace pattern, `ORDER_REPOSITORY_TOKEN`)
- **Pattern B** — CQRS Command/Query handlers with `EventPublisher`
- DTO namespaces (`CreateOrderDto.Input` / `.Output`)
- Output mapper (entity → API DTO)
- Cross-module port (`PaymentGatewayPort`)
- Prisma repository (pure persistence, no events)
- In-memory repository (for unit tests)
- REST controller with `CommandBus` / `QueryBus`
- Request DTOs with `class-validator` + Swagger decorators
- Event listeners: WebSocket broadcast and cross-BC side effect
- Full module wiring (`OrdersModule`)

## Directory structure

```
order-bounded-context/
├── domain/
│   ├── entities/
│   │   ├── order.entity.ts               # Aggregate root, business methods, events
│   │   └── __tests__/
│   │       └── order.entity.spec.ts      # Unit tests for all domain behaviors
│   ├── value-objects/
│   │   ├── order-status.vo.ts            # State machine VO (PENDING→PAID→SHIPPED→DELIVERED)
│   │   ├── money.vo.ts                   # Composed VO with add() operation
│   │   └── __tests__/
│   │       └── order-status.vo.spec.ts   # Valid and invalid transition tests
│   ├── events/
│   │   ├── order-created.event.ts
│   │   ├── order-paid.event.ts
│   │   ├── order-cancelled.event.ts
│   │   └── order-item-added.event.ts
│   ├── errors/
│   │   ├── order-not-found.error.ts      # Extends NotFoundError (-> HTTP 404)
│   │   └── invalid-order-status-transition.error.ts  # Extends DomainError
│   ├── repositories/
│   │   └── order.repository.ts           # Namespace + port token
│   └── testing/
│       └── helpers/
│           └── order.data-builder.ts     # Faker-based builders for tests
│
├── application/
│   ├── dtos/
│   │   ├── create-order.dto.ts           # Input/Output namespace
│   │   └── order-output.mapper.ts        # Entity → DTO mapping
│   ├── commands/
│   │   ├── create-order.command.ts
│   │   ├── create-order.handler.ts       # EventPublisher here, never in entity
│   │   ├── cancel-order.command.ts
│   │   ├── cancel-order.handler.ts
│   │   └── __tests__/
│   │       └── create-order.handler.spec.ts
│   ├── queries/
│   │   ├── get-order.query.ts
│   │   ├── get-order.handler.ts
│   │   ├── list-orders.query.ts
│   │   └── list-orders.handler.ts
│   └── ports/
│       └── payment-gateway.port.ts       # Cross-BC interface
│
└── infrastructure/
    ├── database/
    │   ├── prisma/
    │   │   └── repositories/
    │   │       ├── prisma-order.repository.ts   # Prisma implementation (pure persistence)
    │   │       └── order-model.mapper.ts        # toEntity() uses restore(), toModel() flattens
    │   └── in-memory/
    │       └── repositories/
    │           └── order-in-memory.repository.ts  # For unit tests, no DB needed
    ├── controllers/
    │   ├── orders.controller.ts           # REST, CommandBus + QueryBus
    │   └── dtos/
    │       ├── create-order.request.dto.ts  # class-validator + Swagger
    │       ├── cancel-order.request.dto.ts
    │       └── list-orders.request.dto.ts
    ├── listeners/
    │   ├── order-created-broadcast.handler.ts  # Domain event -> WebSocket
    │   └── order-paid-invoice.handler.ts       # Domain event -> cross-BC command
    ├── adapters/
    │   └── payment-gateway.adapter.ts     # Implements PaymentGatewayPort
    └── orders.module.ts                   # Wires everything: tokens, handlers, exports
```

## Pattern used: Pattern B (CQRS Command/Query)

This example uses **Pattern B** — the module integrates `CqrsModule` and all write/read
operations go through `CommandBus` / `QueryBus`. Handlers are self-registering via decorators:
`@CommandHandler`, `@QueryHandler`, `@EventsHandler`.

Choose Pattern B when:
- The module already uses or will use CQRS
- You need `EventPublisher` to dispatch domain events
- You want commands and queries to be self-discoverable by NestJS

Choose Pattern A (plain UseCase + TOKEN) when the module is simple and doesn't need event publishing.

## Key architectural decisions

### 1. EventPublisher lives in the Handler, never in the Entity

The entity calls `this.apply(event)` internally — that records the event but does NOT publish it.
Publishing requires `EventPublisher.mergeObjectContext(entity)` + `entity.commit()`, which
are framework concerns and belong in the command handler:

```typescript
// In CreateOrderHandler.execute():
this.publisher.mergeObjectContext(order);   // wires EventBus to the entity
await this.repository.save(order);          // persist first
order.commit();                             // then publish — listeners see persisted data
```

### 2. Repository is PURE persistence

`PrismaOrderRepository` only does CRUD. It never dispatches events, never contains business
rules, and never imports from the application layer.

### 3. restore() vs create() on the entity

- `OrderEntity.create()` — for the write path; calls `this.apply(new OrderCreatedEvent(...))`
- `OrderEntity.restore()` — for hydration from DB; emits zero events

The Prisma mapper always uses `restore()`. The handler always uses `create()`.

### 4. Module exports only Port tokens

`OrdersModule` exports `ORDER_REPOSITORY_TOKEN` and `PAYMENT_GATEWAY_PORT`.
It never exports the Prisma class, use cases, or handlers directly. Other modules that need to
read orders import the token and inject the interface.

### 5. class-validator only in controller DTOs

`CreateOrderRequestDto`, `CancelOrderRequestDto`, and `ListOrdersRequestDto` use
`class-validator` and `@nestjs/swagger`. Nothing in `domain/` or `application/` imports
from `class-validator`.

## Using this as a reference

When building your own bounded context with the plugin:

1. Run the `nestjs-hexagonal:domain` skill to scaffold entity, VOs, events, errors, and repository
2. Run `nestjs-hexagonal:application` with Pattern B to scaffold handlers and DTOs
3. Run `nestjs-hexagonal:infrastructure` to scaffold Prisma repo, in-memory repo, and module
4. Run `nestjs-hexagonal:presentation` to scaffold the controller and request DTOs

This example shows what the output of those skills looks like for a realistic domain.
