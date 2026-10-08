# In-Memory Repository — Full Template

Used in unit tests. No NestJS, no Prisma, no external dependencies.

## File Location

```
infrastructure/database/in-memory/repositories/<context>-in-memory.repository.ts
```

## Full Implementation

```typescript
import { <Context>Entity } from '../../../domain/entities/<context>.entity';
import type { <Context>Repository } from '../../../domain/repositories/<context>.repository';

export class <Context>InMemoryRepository implements <Context>Repository.Repository {
  readonly items: Map<string, <Context>Entity> = new Map();
  sortableFields: string[] = ['name', 'createdAt'];

  async findById(id: string): Promise<<Context>Entity | null> {
    return this.items.get(id) ?? null;
  }

  async findByOrganization(organizationId: string): Promise<<Context>Entity[]> {
    return Array.from(this.items.values()).filter(
      (e) => e.organizationId === organizationId,
    );
  }

  async save(entity: <Context>Entity): Promise<void> {
    this.items.set(entity.id, entity);
  }

  async search(
    props: <Context>Repository.SearchParams,
  ): Promise<<Context>Repository.SearchResult> {
    let items = Array.from(this.items.values());

    // Filter by organizationId (always required)
    if (props.filter?.organizationId) {
      items = items.filter((e) => e.organizationId === props.filter!.organizationId);
    }

    // Text filter
    if (props.filter?.name) {
      const term = props.filter.name.toLowerCase();
      items = items.filter((e) => e.name.toLowerCase().includes(term));
    }

    // Sorting
    if (props.sort && this.sortableFields.includes(props.sort)) {
      const field = props.sort as keyof <Context>Entity;
      const dir = props.sortDir === 'asc' ? 1 : -1;
      items = [...items].sort((a, b) => {
        const av = a[field as keyof typeof a];
        const bv = b[field as keyof typeof b];
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
      });
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

## Usage in Unit Tests

```typescript
// application/use-cases/__tests__/create-<context>.use-case.spec.ts
import { describe, it, beforeEach, expect } from 'vitest';
import { <Context>InMemoryRepository } from '../../../infrastructure/database/in-memory/repositories/<context>-in-memory.repository';
import { Create<Context>UseCase } from '../create-<context>.use-case';

describe('Create<Context>UseCase', () => {
  let repo: <Context>InMemoryRepository;
  let useCase: Create<Context>UseCase;

  beforeEach(() => {
    repo = new <Context>InMemoryRepository();
    useCase = new Create<Context>UseCase(repo);
  });

  it('creates and persists a <context>', async () => {
    const result = await useCase.execute({
      organizationId: 'org-1',
      name: 'My Context',
    });

    expect(result.id).toBeDefined();
    const saved = await repo.findById(result.id);
    expect(saved?.name).toBe('My Context');
  });

  it('throws when required field is missing', async () => {
    await expect(
      useCase.execute({ organizationId: 'org-1', name: '' }),
    ).rejects.toThrow();
  });
});
```

## Usage in CQRS Handler Tests

```typescript
import { Test } from '@nestjs/testing';
import { CqrsModule } from '@nestjs/cqrs';
import { dispatch } from '@/shared/events/event-dispatcher';
import { EVENT_DISPATCHER_TOKEN } from '@/shared/events/event-publisher.port';
import { InMemoryEventPublisher } from '@/shared/events/in-memory-event-publisher';
import { <CONTEXT>_REPOSITORY } from '../../../domain/repositories/<context>.repository';
import { <Context>InMemoryRepository } from '../../../infrastructure/database/in-memory/repositories/<context>-in-memory.repository';
import { Create<Context>Handler } from '../create-<context>.handler';

describe('Create<Context>Handler', () => {
  let handler: Create<Context>Handler;
  let repo: <Context>InMemoryRepository;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [CqrsModule],
      providers: [
        Create<Context>Handler,
        { provide: EVENT_DISPATCHER_TOKEN, useFactory: () => dispatch(new InMemoryEventPublisher()) },
        {
          provide: <CONTEXT>_REPOSITORY,
          useClass: <Context>InMemoryRepository,
        },
      ],
    }).compile();

    handler = module.get(Create<Context>Handler);
    repo = module.get(<CONTEXT>_REPOSITORY);
  });

  it('creates a <context> and publishes events', async () => {
    const result = await handler.execute(
      new Create<Context>Command('org-1', 'New Name'),
    );

    expect(result.id).toBeDefined();
    const saved = await repo.findById(result.id);
    expect(saved).not.toBeNull();
  });
});
```

## Notes

- Expose `items` as `readonly` so tests can inspect state directly.
- `delete()` checks `organizationId` — mirrors the same multi-tenant guard as the Prisma implementation.
- Keep it simple: no fancy sorting or pagination optimizations. Tests only care about correctness, not performance.
- For tests that need empty state between cases, use `repo.items.clear()` in `beforeEach`.
