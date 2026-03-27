---
name: application
description: Use when creating application layer artifacts for a NestJS bounded context — use cases, CQRS command/query handlers, DTOs, ports (cross-module interfaces), application services, or read model projections. Supports three patterns: plain UseCase (A), CQRS native (B), and Handler-as-Orchestrator (C).
argument-hint: Use case or pattern (e.g., "CreateOrder", "Pattern B", "port PaymentGateway")
---

> **Note:** Examples use `companyId` as the multi-tenant identifier. Replace with your project's term (e.g., `organizationId`, `tenantId`).

# Application Layer

This skill covers everything inside a bounded context's `application/` directory:
use cases, CQRS handlers, DTOs, ports, application services, and Redis read models.

---

## 1. Pattern Selection

Work through this flowchart before writing a single line of code.

```
Does the module already use CQRS (CommandBus / QueryBus)?
├── No  → Pattern A (plain UseCase + TOKEN)
└── Yes →
        Is this a simple read (findById) with no RBAC or transformation?
        ├── Yes → Skip use case — inject repository directly in controller
        └── No  →
                Does orchestration span multiple services (QueryBus calls,
                multiple ports, complex enrichment)?
                ├── Yes → Pattern C (Handler as Orchestrator)
                └── No  → Pattern B (CQRS Command/Query)

Need read model / projections?
└── CQRS R/W separation: write side → Pattern B/C, read side → Redis query handler
    (see references/read-model-patterns.md)

Reusable logic between 2+ handlers?
└── Extract into Application Service (@Injectable, in application/services/)

Shared domain logic (no I/O, no framework)?
└── Extract into Domain Service (plain class, in domain/services/)
```

---

## 2. Pattern A — Plain UseCase with TOKEN

Use when the context uses plain use cases without CQRS (e.g., `customers`, `contacts`).

### Directory layout

```
application/
├── dtos/
│   └── create-<context>.dto.ts
└── usecases/
    ├── create-<context>.usecase.ts
    └── __tests__/
        └── create-<context>.usecase.spec.ts
```

### DTO

```typescript
// application/dtos/create-<context>.dto.ts
export namespace Create<Context>Dto {
  export interface Input {
    companyId: string;
    name: string;
    // add domain-specific fields
  }

  export interface Output {
    id: string;
    companyId: string;
    name: string;
    createdAt: Date;
  }
}
```

### UseCase class

No `@Injectable`, no NestJS imports. Pure TypeScript class.

```typescript
// application/usecases/create-<context>.usecase.ts
import type { <Context>Repository } from '../../domain/repositories/<context>.repository';
import type { Create<Context>Dto } from '../dtos/create-<context>.dto';
import { <Context>Entity } from '../../domain/entities/<context>.entity';
import { OutputMapper } from '../dtos/<context>-output.dto';

export const CREATE_<CONTEXT>_USE_CASE_TOKEN = Symbol('Create<Context>UseCase');

export namespace Create<Context>UseCase {
  export type Input = Create<Context>Dto.Input;
  export type Output = Create<Context>Dto.Output;

  export class UseCase {
    constructor(
      private readonly repository: <Context>Repository.Repository,
    ) {}

    async execute(input: Input): Promise<Output> {
      const entity = <Context>Entity.create({
        companyId: input.companyId,
        name: input.name,
      });

      await this.repository.insert(entity);

      return OutputMapper.toOutput(entity);
    }
  }
}
```

### Module registration

```typescript
// infrastructure/<context>.module.ts
import {
  CREATE_<CONTEXT>_USE_CASE_TOKEN,
  Create<Context>UseCase,
} from '../application/usecases/create-<context>.usecase';
import { <CONTEXT>_REPOSITORY_TOKEN } from '../domain/repositories/<context>.repository';

@Module({
  providers: [
    Prisma<Context>Repository,
    {
      provide: <CONTEXT>_REPOSITORY_TOKEN,
      useExisting: Prisma<Context>Repository,
    },
    {
      provide: CREATE_<CONTEXT>_USE_CASE_TOKEN,
      useFactory: (repo: <Context>Repository.Repository) =>
        new Create<Context>UseCase.UseCase(repo),
      inject: [<CONTEXT>_REPOSITORY_TOKEN],
    },
  ],
  exports: [<CONTEXT>_REPOSITORY_TOKEN], // NEVER export use cases
})
export class <Context>Module {}
```

### Controller injection

```typescript
constructor(
  @Inject(CREATE_<CONTEXT>_USE_CASE_TOKEN)
  private readonly createUseCase: Create<Context>UseCase.UseCase,
) {}
```

Full template: `references/usecase-plain.md`

---

## 3. Pattern B — CQRS Command/Query Handler

Use when the module already integrates `CqrsModule`. Handlers are self-registering via `@CommandHandler` / `@QueryHandler` — no token needed.

### Directory layout

```
application/
├── dtos/
│   ├── create-<context>.dto.ts
│   └── get-<context>.dto.ts
├── commands/
│   ├── create-<context>.command.ts
│   └── create-<context>.handler.ts
└── queries/
    ├── get-<context>.query.ts
    └── get-<context>.handler.ts
```

### Command

```typescript
// application/commands/create-<context>.command.ts
import { Command } from '@nestjs/cqrs';
import type { Create<Context>Dto } from '../dtos/create-<context>.dto';

export class Create<Context>Command extends Command<Create<Context>Dto.Output> {
  constructor(
    public readonly companyId: string,
    public readonly name: string,
  ) {
    super();
  }
}
```

### Command Handler

```typescript
// application/commands/create-<context>.handler.ts
import { Inject } from '@nestjs/common';
import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';

import type { <Context>Repository } from '../../domain/repositories/<context>.repository';
import { <CONTEXT>_REPOSITORY_TOKEN } from '../../domain/repositories/<context>.repository';
import { <Context>Entity } from '../../domain/entities/<context>.entity';
import type { Create<Context>Dto } from '../dtos/create-<context>.dto';
import { Create<Context>Command } from './create-<context>.command';

@CommandHandler(Create<Context>Command)
export class Create<Context>Handler
  implements ICommandHandler<Create<Context>Command, Create<Context>Dto.Output>
{
  constructor(
    @Inject(<CONTEXT>_REPOSITORY_TOKEN)
    private readonly repository: <Context>Repository.Repository,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: Create<Context>Command): Promise<Create<Context>Dto.Output> {
    // Create entity (entity.apply(event) happens inside Entity.create)
    const entity = <Context>Entity.create({
      companyId: command.companyId,
      name: command.name,
    });

    await this.repository.insert(entity);

    // mergeObjectContext and commit happen in the HANDLER — never in the use case
    this.publisher.mergeObjectContext(entity);
    entity.commit(); // dispatches domain events via EventBus

    return { id: entity.id };
  }
}
```

Key rules for command handlers:
- Write commands return `void` or `{ id: string }` — never the full aggregate.
- `EventPublisher` is injected ONLY in the handler, never in use cases.
- `mergeObjectContext(entity)` + `entity.commit()` happen in the handler after persisting.
- Entity calls `this.apply(event)` internally — that is framework-agnostic.

### Query

```typescript
// application/queries/get-<context>.query.ts
import { Query } from '@nestjs/cqrs';
import type { Get<Context>Dto } from '../dtos/get-<context>.dto';

export class Get<Context>Query extends Query<Get<Context>Dto.Output> {
  constructor(
    public readonly id: string,
    public readonly companyId: string,
  ) {
    super();
  }
}
```

### Query Handler

```typescript
// application/queries/get-<context>.handler.ts
import { Inject, NotFoundException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import type { <Context>Repository } from '../../domain/repositories/<context>.repository';
import { <CONTEXT>_REPOSITORY_TOKEN } from '../../domain/repositories/<context>.repository';
import type { Get<Context>Dto } from '../dtos/get-<context>.dto';
import { Get<Context>Query } from './get-<context>.query';
import { OutputMapper } from '../dtos/<context>-output.dto';

@QueryHandler(Get<Context>Query)
export class Get<Context>Handler
  implements IQueryHandler<Get<Context>Query, Get<Context>Dto.Output>
{
  constructor(
    @Inject(<CONTEXT>_REPOSITORY_TOKEN)
    private readonly repository: <Context>Repository.Repository,
  ) {}

  async execute(query: Get<Context>Query): Promise<Get<Context>Dto.Output> {
    const entity = await this.repository.findById(query.id);

    if (!entity || entity.companyId !== query.companyId) {
      throw new NotFoundException();
    }

    return OutputMapper.toOutput(entity);
  }
}
```

### Module registration

```typescript
// Handlers are self-registering — just add to providers array:
providers: [
  ...existingProviders,
  Create<Context>Handler,
  Get<Context>Handler,
],
```

### Controller dispatch

```typescript
constructor(
  private readonly commandBus: CommandBus,
  private readonly queryBus: QueryBus,
) {}

// CommandBus.execute() return type inferred from Command<T>
const result = await this.commandBus.execute(
  new Create<Context>Command(companyId, name),
);

const item = await this.queryBus.execute(
  new Get<Context>Query(id, companyId),
);
```

Full template: `references/cqrs-command-query.md`

---

## 4. Pattern C — Handler as Orchestrator

Use when a handler must coordinate multiple dependencies: external port calls, QueryBus resolution, complex enrichment before delegating to a pure UseCase.

The handler receives NestJS DI and instantiates framework-agnostic use cases via `new`.
The use case returns the entity so the handler can commit domain events:

```typescript
// application/commands/create-invoice.handler.ts
@CommandHandler(CreateInvoiceCommand)
export class CreateInvoiceHandler
  implements ICommandHandler<CreateInvoiceCommand, { id: string }>
{
  private readonly useCase: CreateInvoiceUseCase.UseCase;

  constructor(
    private readonly queryBus: QueryBus,
    @Inject(INVOICE_REPOSITORY_TOKEN)
    invoiceRepository: InvoiceRepository.Repository,
    @Inject(CUSTOMER_PORT_TOKEN)
    private readonly customerPort: CustomerPort,
    @Inject(LOGGER_PORT_TOKEN)
    logger: LoggerPort,
    private readonly publisher: EventPublisher,
  ) {
    // Instantiate framework-agnostic use case here
    this.useCase = new CreateInvoiceUseCase.UseCase(invoiceRepository, logger);
  }

  async execute({ input }: CreateInvoiceCommand): Promise<{ id: string }> {
    // 1. Resolve external dependencies (ports, QueryBus)
    const config = await this.queryBus.execute(
      new ResolveConfigQuery(input.companyId),
    );

    // 2. Validate / enrich
    const customer = await this.customerPort.findById(input.customerId);

    // 3. Delegate business logic to use case — useCase returns the entity
    const entity = await this.useCase.execute({
      ...input,
      config,
      customer,
    });

    // 4. Handler commits domain events (EventPublisher never enters the use case)
    this.publisher.mergeObjectContext(entity);
    entity.commit();

    return { id: entity.id };
  }
}

// application/usecases/create-invoice.usecase.ts — NO NestJS imports
export namespace CreateInvoiceUseCase {
  export class UseCase {
    constructor(
      private readonly repository: InvoiceRepository.Repository,
      private readonly logger: LoggerPort,
    ) {}

    // Returns the entity so the handler can commit domain events
    async execute(input: Input): Promise<InvoiceEntity> {
      const entity = InvoiceEntity.create({ ...input }); // entity.apply() happens here
      await this.repository.insert(entity);
      return entity;
    }
  }
}
```

Key rules for Pattern C:
- UseCase returns the entity — handler owns `mergeObjectContext` + `commit`.
- `EventPublisher` is injected ONLY in the handler.
- UseCase has zero NestJS imports (except entity base class from shared/domain).
- UseCase is testable without NestJS — just `new UseCase(mockRepo)`.

Benefits:
- UseCase is 100% framework-agnostic — testable without NestJS.
- Handler is a thin wiring layer — testable by mocking only external dependencies.
- UseCase can be reused in other handlers or frameworks.

Full template: `references/cqrs-orchestrator.md`

---

## 5. DTOs

### Namespace pattern (preferred for write operations)

```typescript
// application/dtos/create-<context>.dto.ts
export namespace Create<Context>Dto {
  export interface Input {
    companyId: string;
    name: string;
  }

  export interface Output {
    id: string;
  }
}
```

### Inline in Command class (acceptable for simple commands)

```typescript
export class Create<Context>Command extends Command<{ id: string }> {
  constructor(
    public readonly companyId: string,
    public readonly data: { name: string; description?: string },
  ) {
    super();
  }
}
```

### Output mapper (always extract when mapping is non-trivial)

```typescript
// application/dtos/<context>-output.dto.ts
export class OutputMapper {
  static toOutput(entity: <Context>Entity): <Context>Output {
    return {
      id: entity.id,
      companyId: entity.companyId,
      name: entity.name,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
```

Full template: `references/dto-patterns.md`

---

## 6. Ports (Cross-Module Communication)

A port is an interface defined by the **consumer** module in `application/ports/`. The **provider** module implements it via an adapter in `infrastructure/adapters/`.

```typescript
// <consumer-module>/application/ports/company.port.ts
export const COMPANY_PORT_TOKEN = Symbol('CompanyPort');

export interface CompanyPort {
  findById(id: string): Promise<{
    id: string;
    isActive: boolean;
  } | null>;
}
```

Module wiring in the provider module:

```typescript
// <provider-module>/infrastructure/<provider>.module.ts
providers: [
  CompanyPortAdapter,
  {
    provide: COMPANY_PORT_TOKEN,
    useExisting: CompanyPortAdapter,
  },
],
exports: [COMPANY_PORT_TOKEN],
```

Full template: `references/port-patterns.md`

---

## 7. Application Services

Extract reusable logic shared by 2+ handlers into an Application Service. If only one handler uses it, keep it inline.

```typescript
// application/services/<context>-builder.service.ts
import { Injectable, Inject } from '@nestjs/common';

@Injectable()
export class <Context>BuilderService {
  constructor(
    @Inject(SOME_PORT_TOKEN)
    private readonly somePort: SomePort,
  ) {}

  async build(input: BuildInput): Promise<BuildOutput> {
    // Shared logic
  }
}
```

Register in module `providers` and inject into handlers via `@Inject` or constructor injection.

---

## 8. Domain Services

Shared domain logic with no I/O and no framework. Pure class, no decorators.

```typescript
// domain/services/<context>-resolver.ts
export class <Context>Resolver {
  resolve(entity: <Context>Entity, data: ResolveInput): ResolveOutput {
    // Pure domain logic
  }
}
```

Instantiate directly in the handler or via a factory in the module provider.

---

## 9. Read Model / CQRS R/W Separation

When queries hit Redis instead of Postgres:

- Write side: Command handler → repository → Prisma/PostgreSQL → emit domain event.
- Read side: Query handler → Redis (projected view) → fallback to Prisma on miss.
- Projection updater: `@EventsHandler` that writes to Redis when domain events fire.

Full template: `references/read-model-patterns.md`

---

## 10. Event Handlers

React to domain events dispatched via `entity.commit()`. Use `@EventsHandler`, never `@OnEvent`, for new code.

```typescript
// infrastructure/listeners/<context>-created.handler.ts
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { <Context>CreatedEvent } from '../../domain/events/<context>-created.event';

@EventsHandler(<Context>CreatedEvent)
export class <Context>CreatedHandler implements IEventHandler<<Context>CreatedEvent> {
  handle(event: <Context>CreatedEvent): void {
    // side effects: RabbitMQ publish, WebSocket broadcast, Redis projection
  }
}
```

---

## 11. Rules

- No `@Injectable` / `@Inject` / NestJS imports in UseCase classes (Pattern A and C use cases).
- CQRS handlers (`@CommandHandler`, `@QueryHandler`, `@EventsHandler`) ARE allowed NestJS decorators.
- Always include `companyId` in queries and mutations (multi-tenant enforcement).
- Commands extend `Command<T>`, Queries extend `Query<T>` (NestJS CQRS native).
- Handlers specify full return type: `ICommandHandler<Cmd, ReturnType>`.
- Entity emits events via `this.apply(event)` — never `addDomainEvent()`.
- Handler calls `publisher.mergeObjectContext(entity)` + `entity.commit()` — never `pullDomainEvents()`.
- Modules export only PORT tokens — never use cases, never Prisma repositories.
- `useFactory` + `inject` for use cases in module providers — never `useClass`.
- Ports are defined in the **consumer** module's `application/ports/`, not the provider's.

---

## 12. Testing Checklist

- [ ] UseCase unit test: mock repository, assert output shape.
- [ ] Command handler test: mock repository + EventPublisher, assert `entity.commit()` called.
- [ ] Query handler test: mock repository, assert output mapper applied.
- [ ] Port test: mock adapter, assert interface contract.
- [ ] Application service test: mock ports, test shared logic in isolation.
- [ ] Read model test: mock Redis port, assert fallback to Prisma on miss.

---

## Reference Files

| File | Pattern |
|------|---------|
| `references/usecase-plain.md` | Pattern A full template with tests |
| `references/cqrs-command-query.md` | Pattern B full template with tests |
| `references/cqrs-orchestrator.md` | Pattern C full template with tests |
| `references/port-patterns.md` | Cross-module port contracts |
| `references/dto-patterns.md` | DTO namespaces, inline, output mappers |
| `references/read-model-patterns.md` | Redis R/W separation + projections |
