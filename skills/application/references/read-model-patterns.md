# Read Model Patterns — CQRS R/W Separation

In CQRS, the write side (commands) and read side (queries) can use different
storage mechanisms. The write side uses PostgreSQL via Prisma repositories. The
read side uses Redis projections updated by domain event handlers.

This pattern is most valuable when:
- Queries are called far more frequently than writes.
- The query shape differs significantly from the entity schema.
- You need sub-millisecond read latency.
- The read model aggregates data from multiple entities.

---

## Overview

```
Write side                          Read side
──────────                          ─────────
CommandHandler                      QueryHandler
  → Entity.create()                   → Redis.get(key)
  → Repository.insert()               → if miss: Prisma.findById()
  → actual transaction commit       → Redis.set(key, view)
  → await events.from(entity).publish()
      ↓
  @EventsHandler(EntityCreatedEvent)
    → Redis.set(key, view)
```

---

## 1. Redis Read Model Port

Define the port in the application layer. The adapter lives in the shared
infrastructure or in the module's own infrastructure.

```typescript
// application/ports/redis-read-model.port.ts

export const REDIS_READ_MODEL_PORT_TOKEN = Symbol('RedisReadModelPort');

export interface RedisReadModelPort {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  setMany<T>(
    entries: Array<{ key: string; value: T }>,
    ttlSeconds?: number,
  ): Promise<void>;
}
```

---

## 2. Redis Adapter

```typescript
// infrastructure/adapters/redis-read-model.adapter.ts
import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import type { Redis } from 'ioredis';

import type { RedisReadModelPort } from '../../application/ports/redis-read-model.port';

const DEFAULT_TTL = 3600; // 1 hour

@Injectable()
export class RedisReadModelAdapter implements RedisReadModelPort {
  constructor(
    @InjectRedis()
    private readonly redis: Redis,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    const value = await this.redis.get(key);
    if (!value) return null;
    return JSON.parse(value) as T;
  }

  async set<T>(key: string, value: T, ttlSeconds = DEFAULT_TTL): Promise<void> {
    await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async setMany<T>(
    entries: Array<{ key: string; value: T }>,
    ttlSeconds = DEFAULT_TTL,
  ): Promise<void> {
    const pipeline = this.redis.pipeline();
    for (const { key, value } of entries) {
      pipeline.setex(key, ttlSeconds, JSON.stringify(value));
    }
    await pipeline.exec();
  }
}
```

---

## 3. View Type

Define the Redis view shape separately from the entity and from the HTTP output DTO.
The view is what gets stored in Redis.

```typescript
// application/dtos/<context>-view.dto.ts
export interface ContextView {
  id: string;
  companyId: string;
  name: string;
  status: string;
  itemCount: number;
  totalAmount: number;
  createdAt: string; // ISO string for JSON serialization
  updatedAt?: string;
}

export class ContextViewMapper {
  static fromEntity(entity: ContextEntity): ContextView {
    return {
      id: entity.id,
      companyId: entity.companyId,
      name: entity.name,
      status: entity.status.toString(),
      itemCount: entity.items.length,
      totalAmount: entity.totalAmount,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt?.toISOString(),
    };
  }
}
```

---

## 4. Query Handler (Redis-first)

```typescript
// application/queries/get-<context>.handler.ts
import { Inject, NotFoundException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import type { ContextRepository } from '../../domain/repositories/context.repository';
import { CONTEXT_REPOSITORY_TOKEN } from '../../domain/repositories/context.repository';
import { REDIS_READ_MODEL_PORT_TOKEN } from '../ports/redis-read-model.port';
import type { RedisReadModelPort } from '../ports/redis-read-model.port';
import type { ContextView } from '../dtos/context-view.dto';
import { ContextViewMapper } from '../dtos/context-view.dto';
import { GetContextQuery } from './get-context.query';

@QueryHandler(GetContextQuery)
export class GetContextHandler
  implements IQueryHandler<GetContextQuery, ContextView>
{
  constructor(
    @Inject(REDIS_READ_MODEL_PORT_TOKEN)
    private readonly readModel: RedisReadModelPort,
    @Inject(CONTEXT_REPOSITORY_TOKEN)
    private readonly repository: ContextRepository.Repository,
  ) {}

  async execute(query: GetContextQuery): Promise<ContextView> {
    const key = `context:${query.companyId}:${query.id}`;

    // 1. Try Redis first (hot path)
    const cached = await this.readModel.get<ContextView>(key);
    if (cached) return cached;

    // 2. Fallback to Prisma (cold start or cache miss)
    const entity = await this.repository.findById(query.id);

    if (!entity || entity.companyId !== query.companyId) {
      throw new NotFoundException();
    }

    // 3. Hydrate Redis for next query
    const view = ContextViewMapper.fromEntity(entity);
    await this.readModel.set(key, view);

    return view;
  }
}
```

---

## 5. Projection Updater (Event-Driven)

React to domain events dispatched via `await events.from(entity).publish()` to keep Redis in sync.
Use `@EventsHandler`, never `@OnEvent` for new code.

```typescript
// infrastructure/listeners/context-projection.updater.ts
import { Inject, Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';

import { ContextCreatedEvent } from '../../domain/events/context-created.event';
import { REDIS_READ_MODEL_PORT_TOKEN } from '../../application/ports/redis-read-model.port';
import type { RedisReadModelPort } from '../../application/ports/redis-read-model.port';
import type { ContextRepository } from '../../domain/repositories/context.repository';
import { CONTEXT_REPOSITORY_TOKEN } from '../../domain/repositories/context.repository';
import { ContextViewMapper } from '../../application/dtos/context-view.dto';

@EventsHandler(ContextCreatedEvent)
export class ContextProjectionUpdater
  implements IEventHandler<ContextCreatedEvent>
{
  private readonly logger = new Logger(ContextProjectionUpdater.name);

  constructor(
    @Inject(REDIS_READ_MODEL_PORT_TOKEN)
    private readonly readModel: RedisReadModelPort,
    @Inject(CONTEXT_REPOSITORY_TOKEN)
    private readonly repository: ContextRepository.Repository,
  ) {}

  async handle(event: ContextCreatedEvent): Promise<void> {
    try {
      const entity = await this.repository.findById(event.entityId.toString());
      if (!entity) return;

      const view = ContextViewMapper.fromEntity(entity);
      const key = `context:${entity.companyId}:${entity.id}`;

      await this.readModel.set(key, view);

      // Invalidate list cache — it will be rebuilt on next list query
      await this.readModel.del(`context:list:${entity.companyId}`);
    } catch (error) {
      this.logger.error(
        `Failed to update projection for context ${event.entityId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
```

---

## 6. Module Registration

```typescript
// infrastructure/<context>.module.ts
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { REDIS_READ_MODEL_PORT_TOKEN } from '../application/ports/redis-read-model.port';
import { RedisReadModelAdapter } from './adapters/redis-read-model.adapter';
import { GetContextHandler } from '../application/queries/get-context.handler';
import { ContextProjectionUpdater } from './listeners/context-projection.updater';

@Module({
  imports: [CqrsModule],
  providers: [
    RedisReadModelAdapter,
    {
      provide: REDIS_READ_MODEL_PORT_TOKEN,
      useExisting: RedisReadModelAdapter,
    },
    GetContextHandler,
    ContextProjectionUpdater,
  ],
})
export class ContextModule {}
```

---

## 7. Key Naming Convention

Use predictable, collision-safe keys:

```
<context>:<companyId>:<entityId>       individual record
<context>:list:<companyId>             list view (short TTL)
<context>:page:<companyId>:<page>      paginated list
<context>:summary:<companyId>          aggregated summary
```

Examples:
- `invoice:comp-1:inv-42`
- `invoice:list:comp-1`
- `withdrawal:summary:comp-1`

---

## 8. Unit Tests

### Query handler test (Redis miss -> Prisma fallback)

```typescript
import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GetContextHandler } from '../get-context.handler';
import { GetContextQuery } from '../get-context.query';
import { ContextEntity } from '../../../domain/entities/context.entity';

const mockReadModel = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  setMany: vi.fn(),
};

const mockRepository = { findById: vi.fn() };

describe('GetContextHandler', () => {
  let handler: GetContextHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new GetContextHandler(mockReadModel as any, mockRepository as any);
  });

  it('returns cached view from Redis on hit', async () => {
    const cachedView = { id: 'entity-1', companyId: 'comp-1', name: 'Cached' };
    mockReadModel.get.mockResolvedValue(cachedView);

    const result = await handler.execute(new GetContextQuery('entity-1', 'comp-1'));

    expect(result).toEqual(cachedView);
    expect(mockRepository.findById).not.toHaveBeenCalled();
  });

  it('falls back to Prisma and hydrates Redis on cache miss', async () => {
    mockReadModel.get.mockResolvedValue(null);
    const entity = ContextEntity.restore(
      { companyId: 'comp-1', name: 'Live', createdAt: new Date() },
      'entity-1',
    );
    mockRepository.findById.mockResolvedValue(entity);

    const result = await handler.execute(new GetContextQuery('entity-1', 'comp-1'));

    expect(mockRepository.findById).toHaveBeenCalledWith('entity-1');
    expect(mockReadModel.set).toHaveBeenCalledOnce();
    expect(result.id).toBe('entity-1');
  });

  it('throws NotFoundException on cache miss and missing entity', async () => {
    mockReadModel.get.mockResolvedValue(null);
    mockRepository.findById.mockResolvedValue(null);

    await expect(
      handler.execute(new GetContextQuery('missing', 'comp-1')),
    ).rejects.toThrow(NotFoundException);
  });
});
```

### Projection updater test

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextProjectionUpdater } from '../context-projection.updater';
import { ContextCreatedEvent } from '../../../domain/events/context-created.event';
import { UniqueEntityID } from '@/shared/domain/value-objects/unique-entity.id';
import { ContextEntity } from '../../../domain/entities/context.entity';

const mockReadModel = { set: vi.fn(), del: vi.fn() };
const mockRepository = { findById: vi.fn() };

describe('ContextProjectionUpdater', () => {
  let updater: ContextProjectionUpdater;

  beforeEach(() => {
    vi.clearAllMocks();
    updater = new ContextProjectionUpdater(
      mockReadModel as any,
      mockRepository as any,
    );
  });

  it('writes view to Redis and invalidates list cache on entity created', async () => {
    const entity = ContextEntity.restore(
      { companyId: 'comp-1', name: 'Test', createdAt: new Date() },
      'entity-1',
    );
    mockRepository.findById.mockResolvedValue(entity);

    await updater.handle(new ContextCreatedEvent(new UniqueEntityID('entity-1')));

    expect(mockReadModel.set).toHaveBeenCalledWith(
      'context:comp-1:entity-1',
      expect.objectContaining({ id: 'entity-1' }),
    );
    expect(mockReadModel.del).toHaveBeenCalledWith('context:list:comp-1');
  });

  it('does nothing if entity not found in repository', async () => {
    mockRepository.findById.mockResolvedValue(null);

    await updater.handle(new ContextCreatedEvent(new UniqueEntityID('missing')));

    expect(mockReadModel.set).not.toHaveBeenCalled();
  });
});
```

---

## Checklist

- [ ] `RedisReadModelPort` defined in `application/ports/`, not imported from infrastructure.
- [ ] `RedisReadModelAdapter` lives in `infrastructure/adapters/`.
- [ ] Module registers adapter with `{ provide: REDIS_READ_MODEL_PORT_TOKEN, useExisting: ... }`.
- [ ] Query handler always tries Redis first; falls back to Prisma on `null`.
- [ ] On Prisma fallback, handler calls `readModel.set()` to hydrate cache.
- [ ] Projection updater registered as `@EventsHandler` (not `@OnEvent`).
- [ ] Updater deletes list cache keys when individual items are created/updated/deleted.
- [ ] View DTO uses ISO strings for Date fields (JSON serialization safety).
- [ ] Key pattern includes `companyId` to prevent cross-tenant cache pollution.
- [ ] Unit tests cover Redis hit, Redis miss, and not-found scenarios.
