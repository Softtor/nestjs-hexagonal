---
name: infrastructure
description: Use when creating infrastructure layer artifacts for a NestJS bounded context — Prisma repositories, in-memory repositories (testing), model mappers, NestJS module wiring, adapters (port implementations), or event handler infrastructure. Repository is pure persistence with no event dispatch.
argument-hint: Artifact type or entity (e.g., "repo Order", "module Orders", "adapter PaymentGateway")
---

# Infrastructure Layer

Infrastructure wires the domain to the outside world: databases, event buses, HTTP frameworks, and external services. It is the only layer allowed to import NestJS decorators and Prisma.

## Directory Structure

```
infrastructure/
├── <context>.module.ts           # @Module wiring — exports ONLY port tokens
├── controllers/
│   ├── <context>.controller.ts
│   └── dtos/                     # Request DTOs — class-validator lives here only
│       └── __tests__/
├── database/
│   ├── prisma/
│   │   ├── models/
│   │   │   └── <context>-model.mapper.ts   # static toEntity() / toModel()
│   │   └── repositories/
│   │       ├── prisma-<context>.repository.ts
│   │       └── __tests__/
│   └── in-memory/
│       └── repositories/
│           └── <context>-in-memory.repository.ts   # for unit tests
├── adapters/
│   └── <context>.adapter.ts      # implements cross-module port interface
└── listeners/
    └── <context>-created.handler.ts  # @EventsHandler — side effects only
```

## 1. Prisma Repository

Pure persistence. No domain logic, no event dispatch.

```typescript
// infrastructure/database/prisma/repositories/prisma-<context>.repository.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/shared/infrastructure/database/prisma.service';
import { <Context>Entity } from '../../domain/entities/<context>.entity';
import type { <Context>Repository } from '../../domain/repositories/<context>.repository';

@Injectable()
export class Prisma<Context>Repository implements <Context>Repository.Repository {
  sortableFields: string[] = ['name', 'createdAt'];

  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<<Context>Entity | null> {
    const record = await this.prisma.<context>.findUnique({ where: { id } });
    if (!record) return null;
    return <Context>ModelMapper.toEntity(record);
  }

  async save(entity: <Context>Entity): Promise<void> {
    const data = <Context>ModelMapper.toModel(entity);
    const existing = await this.prisma.<context>.findUnique({ where: { id: entity.id } });
    if (existing) {
      await this.prisma.<context>.update({ where: { id: entity.id }, data });
    } else {
      await this.prisma.<context>.create({ data });
    }
  }

  async search(
    props: <Context>Repository.SearchParams,
  ): Promise<<Context>Repository.SearchResult> {
    const sortable = this.sortableFields.includes(props.sort ?? '') || false;
    const orderByField = sortable ? props.sort : 'createdAt';
    const orderByDir = sortable ? props.sortDir : 'desc';

    const whereClause: Record<string, unknown> = {
      organizationId: props.filter?.organizationId,
    };

    if (typeof props.filter?.name === 'string') {
      whereClause.name = { contains: props.filter.name, mode: 'insensitive' };
    }

    const [count, records] = await Promise.all([
      this.prisma.<context>.count({ where: whereClause }),
      this.prisma.<context>.findMany({
        where: whereClause,
        orderBy: { [orderByField]: orderByDir },
        skip: props.page > 0 ? (props.page - 1) * props.perPage : 0,
        take: props.perPage > 0 ? props.perPage : 15,
      }),
    ]);

    return new <Context>Repository.SearchResult({
      items: records.map(<Context>ModelMapper.toEntity),
      total: count,
      currentPage: props.page,
      perPage: props.perPage,
      sort: orderByField,
      sortDir: orderByDir,
      filter: props.filter,
    });
  }

  async delete(id: string, organizationId: string): Promise<void> {
    await this.prisma.<context>.delete({ where: { id, organizationId } });
  }
}
```

See full template: `references/prisma-repository.md`

## 2. Model Mapper

Bridges Prisma models and domain entities. Static methods only.

```typescript
// infrastructure/database/prisma/models/<context>-model.mapper.ts
import { <Context>Entity } from '../../../domain/entities/<context>.entity';
import type { <Context> } from '@prisma/client';

export class <Context>ModelMapper {
  static toEntity(model: <Context>): <Context>Entity {
    return <Context>Entity.restore(
      {
        organizationId: model.organizationId,
        name: model.name,
        createdAt: model.createdAt,
        updatedAt: model.updatedAt ?? undefined,
      },
      model.id,
    );
  }

  static toModel(entity: <Context>Entity): Omit<<Context>, never> {
    return {
      id: entity.id,
      organizationId: entity.organizationId,
      name: entity.name,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt ?? null,
    };
  }
}
```

Rule: `toEntity()` always calls `Entity.restore()` — never `Entity.create()`.

## 3. In-Memory Repository

For unit tests. Holds state in a plain `Map`. No Prisma, no NestJS.

```typescript
// infrastructure/database/in-memory/repositories/<context>-in-memory.repository.ts
import { <Context>Entity } from '../../../domain/entities/<context>.entity';
import type { <Context>Repository } from '../../../domain/repositories/<context>.repository';

export class <Context>InMemoryRepository implements <Context>Repository.Repository {
  readonly items: Map<string, <Context>Entity> = new Map();
  sortableFields: string[] = ['name', 'createdAt'];

  async findById(id: string): Promise<<Context>Entity | null> {
    return this.items.get(id) ?? null;
  }

  async save(entity: <Context>Entity): Promise<void> {
    this.items.set(entity.id, entity);
  }

  async search(
    props: <Context>Repository.SearchParams,
  ): Promise<<Context>Repository.SearchResult> {
    let items = Array.from(this.items.values()).filter(
      (e) => e.organizationId === props.filter?.organizationId,
    );

    if (props.filter?.name) {
      const term = props.filter.name.toLowerCase();
      items = items.filter((e) => e.name.toLowerCase().includes(term));
    }

    const total = items.length;
    const page = props.page ?? 1;
    const perPage = props.perPage ?? 15;
    const start = (page - 1) * perPage;

    return new <Context>Repository.SearchResult({
      items: items.slice(start, start + perPage),
      total,
      currentPage: page,
      perPage,
      sort: props.sort ?? null,
      sortDir: props.sortDir ?? null,
      filter: props.filter ?? null,
    });
  }

  async delete(id: string, organizationId: string): Promise<void> {
    const entity = this.items.get(id);
    if (entity?.organizationId === organizationId) {
      this.items.delete(id);
    }
  }
}
```

See full template: `references/in-memory-repository.md`

## 4. Module Wiring

Module exports ONLY port tokens. Never use cases, never Prisma classes.

```typescript
// infrastructure/<context>.module.ts
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { DatabaseModule } from '@/shared/infrastructure/database/database.module';
import { <CONTEXT>_REPOSITORY } from '../domain/repositories/<context>.repository';
import { Prisma<Context>Repository } from './database/prisma/repositories/prisma-<context>.repository';
import { Create<Context>Handler } from '../application/commands/create-<context>.handler';
import { Get<Context>Handler } from '../application/queries/get-<context>.handler';
import { <Context>CreatedHandler } from './listeners/<context>-created.handler';
import { <Context>Controller } from './controllers/<context>.controller';

@Module({
  imports: [CqrsModule, DatabaseModule],
  controllers: [<Context>Controller],
  providers: [
    Prisma<Context>Repository,
    { provide: <CONTEXT>_REPOSITORY, useExisting: Prisma<Context>Repository },
    Create<Context>Handler,
    Get<Context>Handler,
    <Context>CreatedHandler,
  ],
  exports: [<CONTEXT>_REPOSITORY],  // NEVER export use cases or repositories
})
export class <Context>Module {}
```

For plain UseCase pattern (non-CQRS), inject via `useFactory`:

```typescript
{
  provide: CREATE_<CONTEXT>_USE_CASE_TOKEN,
  useFactory: (repo: <Context>Repository.Repository) =>
    new Create<Context>UseCase(repo),
  inject: [<CONTEXT>_REPOSITORY],
},
```

See full template: `references/module-wiring.md`

## 5. Adapter Pattern

Adapters implement port interfaces defined in other bounded contexts. They translate between the external contract and the local domain.

```typescript
// infrastructure/adapters/<context>.adapter.ts
import { Injectable } from '@nestjs/common';
import { <ExternalPort> } from '@/<other-context>/application/ports/<external>.port';
import { <Context>Service } from '../services/<context>.service';

@Injectable()
export class <Context>Adapter implements <ExternalPort> {
  constructor(private readonly service: <Context>Service) {}

  async findById(id: string): Promise<ExternalPortProps | null> {
    const entity = await this.service.findById(id);
    return entity ? this.mapToProps(entity) : null;
  }

  private mapToProps(entity: <Context>Entity): ExternalPortProps {
    return { id: entity.id, name: entity.name };
  }
}

// In module providers:
// <Context>Adapter,
// { provide: '<ExternalPort>', useExisting: <Context>Adapter },
// exports: ['<ExternalPort>'],
```

See full template: `references/adapter-patterns.md`

## 6. Event Handler Infrastructure

Event handlers react to domain events and perform side effects. They must never throw — log errors and continue.

```typescript
// infrastructure/listeners/<context>-created.handler.ts
import { Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { <Context>CreatedEvent } from '../../domain/events/<context>-created.event';

@EventsHandler(<Context>CreatedEvent)
export class <Context>CreatedHandler implements IEventHandler<<Context>CreatedEvent> {
  private readonly logger = new Logger(<Context>CreatedHandler.name);

  async handle(event: <Context>CreatedEvent): Promise<void> {
    try {
      // side effects: publish to RabbitMQ, broadcast via WebSocket, update Redis projection
      this.logger.log(`Handling <Context>CreatedEvent for ${event.entityId}`);
    } catch (error) {
      this.logger.error(
        `Failed to handle <Context>CreatedEvent: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
```

Use `@EventsHandler` + `IEventHandler` for all new code. Never use `@OnEvent` for domain event handlers.

See full template: `references/event-infra-patterns.md`

## Rules

- Repository is PURE persistence — `save()`, `findById()`, `search()`, `delete()`. No event dispatch.
- Events are committed by the **Handler** via `entity.commit()` after `repo.save()`.
- Module exports ONLY port tokens — never use cases, never Prisma repository classes.
- Adapters implement port interfaces with `{ provide: TOKEN, useExisting: Adapter }`.
- `class-validator` is ONLY allowed in presentation request DTOs.
- Event handlers use `@EventsHandler` + `IEventHandler` — never `@OnEvent` for new code.
- `organizationId` in every Prisma query (multi-tenant isolation).
  **Exception:** `findById(id)` may omit `organizationId` when used internally after authorization has been verified at the controller/guard level. For user-facing queries, prefer `findById(id, organizationId)`.
- Use `Entity.restore()` in mappers — never `Entity.create()`.

## Checklist

- [ ] Prisma repository: `@Injectable()`, implements domain repository interface
- [ ] `save()` uses upsert (findById check + create/update), not bare `upsert`
- [ ] `search()` always scopes by `organizationId` in whereClause
- [ ] Model mapper: `toEntity()` calls `Entity.restore()`, `toModel()` returns plain data
- [ ] In-memory repository: state in `Map`, no external dependencies
- [ ] Module imports `CqrsModule` + `DatabaseModule` (or equivalent)
- [ ] Module providers: Prisma repo class + `{ provide: TOKEN, useExisting: ... }`
- [ ] CQRS handlers listed in providers (auto-registered via `@CommandHandler`/`@QueryHandler`)
- [ ] Event handlers listed in providers (auto-registered via `@EventsHandler`)
- [ ] Module `exports` contains ONLY the port token Symbol(s)
- [ ] Adapter class: `@Injectable()`, implements external port interface
- [ ] Adapter registered: `{ provide: TOKEN, useExisting: Adapter }` + exported
- [ ] Event handlers: `try/catch` with logger, never re-throw
- [ ] Run `pnpm lint && pnpm check-types` before committing
