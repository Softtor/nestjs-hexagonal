# Pattern B — CQRS Command/Query Handler

Full template for modules that use `CqrsModule`. Handlers self-register via
`@CommandHandler` / `@QueryHandler` — no TOKEN symbol needed for them.

`EventDispatcher` is injected only in the command handler. The use case (if any)
is framework-agnostic and returns entities; the handler publishes after persistence and the actual transaction commit.

---

## Directory layout

```
application/
├── dtos/
│   ├── create-<context>.dto.ts
│   ├── update-<context>.dto.ts
│   ├── get-<context>.dto.ts
│   └── <context>-output.dto.ts
├── commands/
│   ├── create-<context>.command.ts
│   ├── create-<context>.handler.ts
│   ├── update-<context>.command.ts
│   └── update-<context>.handler.ts
└── queries/
    ├── get-<context>.query.ts
    ├── get-<context>.handler.ts
    ├── list-<contexts>.query.ts
    └── list-<contexts>.handler.ts
```

---

## Command

```typescript
// application/commands/create-<context>.command.ts
import { Command } from '@nestjs/cqrs';
import type { Create<Context>Dto } from '../dtos/create-<context>.dto';

export class Create<Context>Command extends Command<Create<Context>Dto.Output> {
  constructor(
    public readonly companyId: string,
    public readonly name: string,
    public readonly description?: string,
  ) {
    super();
  }
}
```

For inline DTO (no separate DTO file):

```typescript
export class Create<Context>Command extends Command<{ id: string }> {
  constructor(
    public readonly companyId: string,
    public readonly data: {
      name: string;
      description?: string;
    },
  ) {
    super();
  }
}
```

---

## Command Handler

`EventDispatcher` is always injected here. The entity's domain events (set up via
`entity.apply()` inside `Entity.create()`) are dispatched only after the handler
calls `await events.from(entity).publish()`.

```typescript
// application/commands/create-<context>.handler.ts
import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { EVENT_DISPATCHER_TOKEN } from '@/shared/events/event-publisher.port';
import { EventDispatcher } from '@/shared/events/event-dispatcher';

import type { <Context>Repository } from '../../domain/repositories/<context>.repository';
import { <CONTEXT>_REPOSITORY_TOKEN } from '../../domain/repositories/<context>.repository';
import { <Context>Entity } from '../../domain/entities/<context>.entity';
import type { Create<Context>Dto } from '../dtos/create-<context>.dto';
import { <Context>OutputMapper } from '../dtos/<context>-output.dto';
import { Create<Context>Command } from './create-<context>.command';

@CommandHandler(Create<Context>Command)
export class Create<Context>Handler
  implements ICommandHandler<Create<Context>Command, Create<Context>Dto.Output>
{
  constructor(
    @Inject(<CONTEXT>_REPOSITORY_TOKEN)
    private readonly repository: <Context>Repository.Repository,
    @Inject(EVENT_DISPATCHER_TOKEN) private readonly events: EventDispatcher,
  ) {}

  async execute(command: Create<Context>Command): Promise<Create<Context>Dto.Output> {
    // Entity.create() calls this.apply(event) internally
    const entity = <Context>Entity.create({
      companyId: command.companyId,
      name: command.name,
      description: command.description,
    });

    await this.repository.insert(entity);

    // Publish the queued snapshot and acknowledge each successful event.
    await this.events.from(entity).publish(); // after persistence / actual transaction commit

    // Write commands return void or { id } — never the full aggregate
    return { id: entity.id };
  }
}
```

---

## Update Command Handler (persist + dispatch pattern)

```typescript
// application/commands/update-<context>.handler.ts
import { Inject, NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { EVENT_DISPATCHER_TOKEN } from '@/shared/events/event-publisher.port';
import { EventDispatcher } from '@/shared/events/event-dispatcher';

import type { <Context>Repository } from '../../domain/repositories/<context>.repository';
import { <CONTEXT>_REPOSITORY_TOKEN } from '../../domain/repositories/<context>.repository';
import { Update<Context>Command } from './update-<context>.command';

@CommandHandler(Update<Context>Command)
export class Update<Context>Handler
  implements ICommandHandler<Update<Context>Command, void>
{
  constructor(
    @Inject(<CONTEXT>_REPOSITORY_TOKEN)
    private readonly repository: <Context>Repository.Repository,
    @Inject(EVENT_DISPATCHER_TOKEN) private readonly events: EventDispatcher,
  ) {}

  async execute(command: Update<Context>Command): Promise<void> {
    const entity = await this.repository.findById(command.id);

    if (!entity || entity.companyId !== command.companyId) {
      throw new NotFoundException();
    }

    entity.update({ name: command.name, description: command.description });

    await this.repository.update(entity);

    await this.events.from(entity).publish(); // after persistence / actual transaction commit
  }
}
```

---

## Query

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

---

## Query Handler

Query handlers do not use `EventDispatcher`. They read from the repository and map to output.

```typescript
// application/queries/get-<context>.handler.ts
import { Inject, NotFoundException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import type { <Context>Repository } from '../../domain/repositories/<context>.repository';
import { <CONTEXT>_REPOSITORY_TOKEN } from '../../domain/repositories/<context>.repository';
import type { Get<Context>Dto } from '../dtos/get-<context>.dto';
import { <Context>OutputMapper } from '../dtos/<context>-output.dto';
import { Get<Context>Query } from './get-<context>.query';

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

    return <Context>OutputMapper.toOutput(entity);
  }
}
```

---

## List Query Handler

```typescript
// application/queries/list-<contexts>.handler.ts
import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import type { <Context>Repository } from '../../domain/repositories/<context>.repository';
import { <CONTEXT>_REPOSITORY_TOKEN } from '../../domain/repositories/<context>.repository';
import type { List<Contexts>Dto } from '../dtos/list-<contexts>.dto';
import { <Context>OutputMapper } from '../dtos/<context>-output.dto';
import { List<Contexts>Query } from './list-<contexts>.query';

@QueryHandler(List<Contexts>Query)
export class List<Contexts>Handler
  implements IQueryHandler<List<Contexts>Query, List<Contexts>Dto.Output>
{
  constructor(
    @Inject(<CONTEXT>_REPOSITORY_TOKEN)
    private readonly repository: <Context>Repository.Repository,
  ) {}

  async execute(query: List<Contexts>Query): Promise<List<Contexts>Dto.Output> {
    const items = await this.repository.findByCompany(query.companyId, {
      page: query.page,
      perPage: query.perPage,
    });

    return {
      items: items.map(<Context>OutputMapper.toOutput),
      total: items.length,
    };
  }
}
```

---

## Module Registration

Handlers are self-registering — add them to the `providers` array without any token:

```typescript
// infrastructure/<context>.module.ts
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { <CONTEXT>_REPOSITORY_TOKEN } from '../domain/repositories/<context>.repository';
import { Create<Context>Handler } from '../application/commands/create-<context>.handler';
import { Update<Context>Handler } from '../application/commands/update-<context>.handler';
import { Get<Context>Handler } from '../application/queries/get-<context>.handler';
import { List<Contexts>Handler } from '../application/queries/list-<contexts>.handler';
import { <Context>Controller } from './controllers/<context>.controller';
import { Prisma<Context>Repository } from './repositories/prisma-<context>.repository';

const commandHandlers = [Create<Context>Handler, Update<Context>Handler];
const queryHandlers = [Get<Context>Handler, List<Contexts>Handler];

@Module({
  imports: [CqrsModule],
  controllers: [<Context>Controller],
  providers: [
    Prisma<Context>Repository,
    {
      provide: <CONTEXT>_REPOSITORY_TOKEN,
      useExisting: Prisma<Context>Repository,
    },
    ...commandHandlers,
    ...queryHandlers,
  ],
  exports: [<CONTEXT>_REPOSITORY_TOKEN], // NEVER export handlers
})
export class <Context>Module {}
```

---

## Controller Dispatch

```typescript
// infrastructure/controllers/<context>.controller.ts
import { Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { FastifyRequest } from 'fastify';

import { Create<Context>Command } from '../../application/commands/create-<context>.command';
import { Get<Context>Query } from '../../application/queries/get-<context>.query';
import { Create<Context>RequestDto } from './dtos/create-<context>.request.dto';

@Controller('<contexts>')
export class <Context>Controller {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post()
  async create(
    @Body() dto: Create<Context>RequestDto,
    @Req() req: FastifyRequest,
  ) {
    // Return type inferred from Command<T> generic
    return this.commandBus.execute(
      new Create<Context>Command(req.user.companyId, dto.name, dto.description),
    );
  }

  @Get(':id')
  async findById(@Param('id') id: string, @Req() req: FastifyRequest) {
    return this.queryBus.execute(
      new Get<Context>Query(id, req.user.companyId),
    );
  }
}
```

---

## Unit Tests

### Command handler test

```typescript
// application/commands/__tests__/create-<context>.handler.spec.ts
import { dispatch } from '@/shared/events/event-dispatcher';
import { InMemoryEventPublisher } from '@/shared/events/in-memory-event-publisher';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Create<Context>Handler } from '../create-<context>.handler';
import { Create<Context>Command } from '../create-<context>.command';

const mockRepository = {
  insert: vi.fn(),
  findById: vi.fn(),
  update: vi.fn(),
};

const publisher = new InMemoryEventPublisher(() => {
  expect(mockRepository.insert).toHaveBeenCalledOnce();
});
const events = dispatch(publisher);

describe('Create<Context>Handler', () => {
  let handler: Create<Context>Handler;

  beforeEach(() => {
    vi.clearAllMocks();
    publisher.publications.length = 0;
    handler = new Create<Context>Handler(
      mockRepository as any,
      events,
    );
  });

  it('creates entity, persists, and publishes events', async () => {
    const command = new Create<Context>Command('company-1', 'Test Item');

    const result = await handler.execute(command);

    expect(mockRepository.insert).toHaveBeenCalledOnce();
    expect(publisher.publications).toHaveLength(1);
    expect(result.id).toBeDefined();
  });

  it('does not publish when persistence fails', async () => {
    mockRepository.insert.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(handler.execute(new Create<Context>Command('company-1', 'Test Item')))
      .rejects.toThrow('database unavailable');
    expect(publisher.publications).toHaveLength(0);
  });
});
```

### Query handler test

```typescript
// application/queries/__tests__/get-<context>.handler.spec.ts
import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { <Context>Entity } from '../../../domain/entities/<context>.entity';
import { Get<Context>Handler } from '../get-<context>.handler';
import { Get<Context>Query } from '../get-<context>.query';

const mockRepository = {
  findById: vi.fn(),
};

describe('Get<Context>Handler', () => {
  let handler: Get<Context>Handler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new Get<Context>Handler(mockRepository as any);
  });

  it('returns mapped output for existing entity', async () => {
    const entity = <Context>Entity.restore(
      { companyId: 'company-1', name: 'Test', createdAt: new Date() },
      'entity-id',
    );
    mockRepository.findById.mockResolvedValue(entity);

    const result = await handler.execute(
      new Get<Context>Query('entity-id', 'company-1'),
    );

    expect(result.id).toBe('entity-id');
    expect(result.name).toBe('Test');
  });

  it('throws NotFoundException when entity not found', async () => {
    mockRepository.findById.mockResolvedValue(null);

    await expect(
      handler.execute(new Get<Context>Query('missing', 'company-1')),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException for cross-company access', async () => {
    const entity = <Context>Entity.restore(
      { companyId: 'other-company', name: 'Test', createdAt: new Date() },
      'entity-id',
    );
    mockRepository.findById.mockResolvedValue(entity);

    await expect(
      handler.execute(new Get<Context>Query('entity-id', 'company-1')),
    ).rejects.toThrow(NotFoundException);
  });
});
```

---

## Checklist

- [ ] Command extends `Command<T>`, Query extends `Query<T>`.
- [ ] Handler implements `ICommandHandler<Command, ReturnType>` with explicit return type.
- [ ] `EventDispatcher` injected only in command handlers, never in query handlers.
- [ ] Each queued event is acknowledged only after publisher success; failures retain the remaining queue.
- [ ] `await events.from(entity).publish()` called after `repository.insert/update` and the actual transaction commit.
- [ ] Write commands return `void` or `{ id: string }`, never the full aggregate.
- [ ] Query handlers never mutate state, never use `EventDispatcher`.
- [ ] `companyId` verified on every query/mutation (multi-tenant enforcement).
- [ ] Module includes `CqrsModule` in `imports`.
- [ ] Module exports only repository PORT token, not handlers.
