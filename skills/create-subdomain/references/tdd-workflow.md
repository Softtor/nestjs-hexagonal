# TDD Workflow Reference

Test-first sequence for each layer. Write the test, watch it fail, write the implementation, watch it pass. Never write implementation before the test.

---

## Testing Pyramid

```
         /\
        /  \   E2E (few)
       /----\  Infrastructure integration (some)
      /      \ Application unit (many)
     /--------\ Domain unit (most)
```

- Domain: maximum unit tests, pure functions, no I/O
- Application: unit tests with in-memory repositories and mock ports
- Infrastructure: integration tests with real Prisma or TestContainers
- Presentation: controller tests with mocked bus/use case
- E2E: minimal, covering the full HTTP → database round trip

---

## Domain Layer

### Entity spec template

```typescript
// domain/entities/__tests__/unit/<name>.entity.spec.ts
import { describe, it, expect } from 'vitest';
import { faker } from '@faker-js/faker';
import { <Name>Entity } from '../../<name>.entity';
import { <Name>DataBuilder } from '../../../testing/helpers/<name>.data-builder';
import { <Name>CreatedEvent } from '../../../events/<name>-created.event';
import { <Name>UpdatedEvent } from '../../../events/<name>-updated.event';

describe('<Name>Entity', () => {
  describe('create()', () => {
    it('creates entity with valid props', () => {
      const props = <Name>DataBuilder();
      const entity = <Name>Entity.create(props);

      expect(entity.id).toBeDefined();
      expect(entity.name).toBe(props.name);
      expect(entity.tenantId).toBe(props.tenantId);
      expect(entity.createdAt).toBeInstanceOf(Date);
      expect(entity.updatedAt).toBeUndefined();
    });

    it('applies <Name>CreatedEvent exactly once', () => {
      const entity = <Name>Entity.create(<Name>DataBuilder());
      const events = entity.getUncommittedEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(<Name>CreatedEvent);
    });

    it('assigns explicit id when provided', () => {
      const id = faker.string.uuid();
      const entity = <Name>Entity.create(<Name>DataBuilder(), id);

      expect(entity.id).toBe(id);
    });

    it('throws EntityValidationError when name is empty', () => {
      expect(() =>
        <Name>Entity.create(<Name>DataBuilder({ name: '' })),
      ).toThrow();
    });
  });

  describe('restore()', () => {
    it('hydrates entity from persistence without emitting events', () => {
      const props = <Name>DataBuilder();
      const id = faker.string.uuid();
      const entity = <Name>Entity.restore(props, id);

      expect(entity.id).toBe(id);
      expect(entity.name).toBe(props.name);
      expect(entity.getUncommittedEvents()).toHaveLength(0);
    });
  });

  describe('update()', () => {
    it('updates the name and touches updatedAt', () => {
      const entity = <Name>Entity.create(<Name>DataBuilder());
      entity.getUncommittedEvents().forEach((event) => entity.acknowledgeEvent(event)); // discard creation events in this fixture only

      entity.update('updated-name');

      expect(entity.name).toBe('updated-name');
      expect(entity.updatedAt).toBeInstanceOf(Date);
    });

    it('applies <Name>UpdatedEvent after update', () => {
      const entity = <Name>Entity.create(<Name>DataBuilder());
      events.from(entity).publish();

      entity.update('new-name');
      const events = entity.getUncommittedEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(<Name>UpdatedEvent);
    });
  });

  // Add one describe block per mutating method
});
```

**What to assert in entity tests:**
- Props set correctly on `create()`
- Correct event type in `getUncommittedEvents()`, exactly one event per operation
- `restore()` produces zero uncommitted events
- Mutating methods update the field and set `updatedAt`
- Validation errors thrown for invalid inputs (empty strings, negative numbers, null required fields)
- `id` can be provided explicitly and is preserved

### VO spec template

```typescript
// domain/value-objects/__tests__/<name>.vo.spec.ts
import { describe, it, expect } from 'vitest';
import { EmailVO } from '../email.vo';
import { InvalidArgumentError } from '@/shared/domain-errors/errors';

describe('EmailVO', () => {
  describe('create()', () => {
    it('accepts a valid email and normalises to lowercase', () => {
      const vo = EmailVO.create('User@Example.COM');
      expect(vo.value).toBe('user@example.com');
    });

    it('throws InvalidArgumentError for missing @', () => {
      expect(() => EmailVO.create('not-an-email')).toThrow(InvalidArgumentError);
    });

    it('throws InvalidArgumentError for empty string', () => {
      expect(() => EmailVO.create('')).toThrow(InvalidArgumentError);
    });
  });

  describe('equals()', () => {
    it('returns true when values match', () => {
      const a = EmailVO.create('a@b.com');
      const b = EmailVO.create('a@b.com');
      expect(a.equals(b)).toBe(true);
    });

    it('returns false when values differ', () => {
      expect(EmailVO.create('a@b.com').equals(EmailVO.create('c@d.com'))).toBe(false);
    });
  });
});
```

**What to assert in VO tests:**
- Valid input creates VO without throwing
- Each invalid input case throws the correct error type with a meaningful message
- Equality: two VOs with the same value are equal; different values are not equal
- Normalisation: trimming, casing, formatting applied consistently
- State machine: every valid transition succeeds; every invalid transition throws
- Immutability: mutating methods return a new VO instance, original unchanged

### Data builder conventions

```typescript
// domain/testing/helpers/<name>.data-builder.ts
import { faker } from '@faker-js/faker';
import type { <Name>Props } from '../../entities/<name>.entity';

export function <Name>DataBuilder(overrides?: Partial<<Name>Props>): <Name>Props {
  return {
    tenantId: faker.string.uuid(),
    name: faker.commerce.productName(),
    createdAt: new Date(),
    updatedAt: undefined,
    ...overrides,
  };
}

// State-specific variants — create when tests need a particular state
export function Active<Name>DataBuilder(overrides?: Partial<<Name>Props>): <Name>Props {
  return <Name>DataBuilder({ status: '<Name>StatusEnum.ACTIVE', ...overrides });
}

export function Pending<Name>DataBuilder(overrides?: Partial<<Name>Props>): <Name>Props {
  return <Name>DataBuilder({ status: '<Name>StatusEnum.PENDING', ...overrides });
}
```

---

## Application Layer

### UseCase spec template (Pattern A)

```typescript
// application/usecases/__tests__/create-<context>.usecase.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';
import { Create<Context>UseCase } from '../create-<context>.usecase';
import { <Context>InMemoryRepository } from '../../../infrastructure/database/in-memory/repositories/<context>-in-memory.repository';
import { <Context>DataBuilder } from '../../../domain/testing/helpers/<context>.data-builder';

describe('Create<Context>UseCase', () => {
  let useCase: Create<Context>UseCase.UseCase;
  let repository: <Context>InMemoryRepository;

  beforeEach(() => {
    repository = new <Context>InMemoryRepository();
    useCase = new Create<Context>UseCase.UseCase(repository);
  });

  it('creates entity and persists it', async () => {
    const input = {
      tenantId: faker.string.uuid(),
      name: faker.commerce.productName(),
    };

    const output = await useCase.execute(input);

    expect(output.id).toBeDefined();
    expect(output.name).toBe(input.name);
    expect(repository.items.size).toBe(1);
  });

  it('throws when name is empty', async () => {
    await expect(
      useCase.execute({ tenantId: faker.string.uuid(), name: '' }),
    ).rejects.toThrow();
  });
});
```

### Command Handler spec template (Pattern B)

```typescript
// application/commands/__tests__/create-<context>.handler.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { faker } from '@faker-js/faker';
import { dispatch } from '@/shared/events/event-dispatcher';
import { InMemoryEventPublisher } from '@/shared/events/in-memory-event-publisher';
import { Create<Context>Handler } from '../create-<context>.handler';
import { Create<Context>Command } from '../create-<context>.command';
import { <Context>InMemoryRepository } from '../../../infrastructure/database/in-memory/repositories/<context>-in-memory.repository';

describe('Create<Context>Handler', () => {
  let handler: Create<Context>Handler;
  let repository: <Context>InMemoryRepository;
  let publisher: InMemoryEventPublisher;

  beforeEach(() => {
    repository = new <Context>InMemoryRepository();
    publisher = new InMemoryEventPublisher(() => {
      expect(repository.items.size).toBe(1); // persistence precedes publication
    });

    handler = new Create<Context>Handler(repository, dispatch(publisher));
  });

  it('returns { id } and persists entity', async () => {
    const command = new Create<Context>Command(
      faker.string.uuid(),
      faker.commerce.productName(),
    );

    const result = await handler.execute(command);

    expect(result).toEqual({ id: expect.any(String) });
    expect(repository.items.size).toBe(1);
  });

  it('publishes only after persistence', async () => {
    const command = new Create<Context>Command(
      faker.string.uuid(),
      faker.commerce.productName(),
    );

    await handler.execute(command);

    expect(publisher.publications).toHaveLength(1);
  });
});
```

**What to assert in application tests:**
- Output shape matches the DTO interface exactly
- Repository `items` (in-memory) grows by 1 after a create operation
- Publications contain the expected domain event, persistence precedes publication, and persistence failure produces no publications
- Error propagation: domain errors from entity construction bubble up
- Query handlers: `null` from repo triggers `NotFoundException`
- Pattern C: ports are called with correct arguments before use case is invoked

---

## Infrastructure Layer

### Prisma repository integration test template

```typescript
// infrastructure/database/prisma/repositories/__tests__/prisma-<context>.repository.spec.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { faker } from '@faker-js/faker';
import { Prisma<Context>Repository } from '../prisma-<context>.repository';
import { <Context>DataBuilder } from '../../../../domain/testing/helpers/<context>.data-builder';
import { <Context>Entity } from '../../../../domain/entities/<context>.entity';

// Use a test database (TestContainers or a dedicated test DB)
describe('Prisma<Context>Repository (integration)', () => {
  let prisma: PrismaClient;
  let repo: Prisma<Context>Repository;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    repo = new Prisma<Context>Repository(prisma as never);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.<context>.deleteMany();
  });

  it('saves and retrieves an entity by id', async () => {
    const entity = <Context>Entity.create(<Context>DataBuilder());
    await repo.save(entity);

    const found = await repo.findById(entity.id);

    expect(found).not.toBeNull();
    expect(found!.id).toBe(entity.id);
    expect(found!.name).toBe(entity.name);
  });

  it('returns null for an unknown id', async () => {
    const result = await repo.findById(faker.string.uuid());
    expect(result).toBeNull();
  });

  it('updates an existing entity on second save', async () => {
    const entity = <Context>Entity.create(<Context>DataBuilder());
    await repo.save(entity);

    entity.update('updated-name');
    await repo.save(entity);

    const found = await repo.findById(entity.id);
    expect(found!.name).toBe('updated-name');
  });

  it('deletes entity scoped by tenantId', async () => {
    const entity = <Context>Entity.create(<Context>DataBuilder());
    await repo.save(entity);

    await repo.delete(entity.id, entity.tenantId);

    expect(await repo.findById(entity.id)).toBeNull();
  });

  it('search returns paginated results scoped to tenantId', async () => {
    const tenantId = faker.string.uuid();
    const other = faker.string.uuid();

    await Promise.all([
      repo.save(<Context>Entity.create(<Context>DataBuilder({ tenantId }))),
      repo.save(<Context>Entity.create(<Context>DataBuilder({ tenantId }))),
      repo.save(<Context>Entity.create(<Context>DataBuilder({ tenantId: other }))),
    ]);

    const result = await repo.search(
      new <Context>Repository.SearchParams({ filter: { tenantId }, page: 1, perPage: 10 }),
    );

    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
  });
});
```

**What to assert in infrastructure tests:**
- `save()` persists entity; subsequent `findById()` returns the entity with all fields
- `save()` on existing entity updates without creating a duplicate (upsert semantics)
- `findById()` returns `null` for unknown id
- `delete()` scoped by both `id` and `tenantId` — deleting with wrong `tenantId` must not delete
- `search()` respects `tenantId` isolation — results from other tenants never appear
- `search()` pagination: correct items slice, correct `total` count

### Module spec template (optional — for wiring validation)

```typescript
// infrastructure/__tests__/<context>.module.spec.ts
import { Test } from '@nestjs/testing';
import { describe, it, expect } from 'vitest';
import { <Context>Module } from '../<context>.module';
import { <CONTEXT>_REPOSITORY } from '../../domain/repositories/<context>.repository';

describe('<Context>Module', () => {
  it('resolves the repository port token', async () => {
    const module = await Test.createTestingModule({
      imports: [<Context>Module],
    }).compile();

    const repo = module.get(<CONTEXT>_REPOSITORY);
    expect(repo).toBeDefined();
  });
});
```

---

## Presentation Layer

### Controller spec template

```typescript
// infrastructure/controllers/__tests__/<context>.controller.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { faker } from '@faker-js/faker';
import { <Context>Controller } from '../<context>.controller';

describe('<Context>Controller', () => {
  let controller: <Context>Controller;
  let commandBus: { execute: ReturnType<typeof vi.fn> };
  let queryBus: { execute: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    commandBus = { execute: vi.fn() };
    queryBus = { execute: vi.fn() };

    const module = await Test.createTestingModule({
      controllers: [<Context>Controller],
      providers: [
        { provide: CommandBus, useValue: commandBus },
        { provide: QueryBus, useValue: queryBus },
      ],
    }).compile();

    controller = module.get(<Context>Controller);
  });

  describe('create()', () => {
    it('dispatches Create<Context>Command and returns { id }', async () => {
      const id = faker.string.uuid();
      commandBus.execute.mockResolvedValueOnce({ id });

      const result = await controller.create(
        { name: 'Test' },
        { id: faker.string.uuid() } as never,
      );

      expect(commandBus.execute).toHaveBeenCalledOnce();
      expect(result).toEqual({ id });
    });
  });

  describe('findOne()', () => {
    it('dispatches Get<Context>Query and returns the entity', async () => {
      const output = { id: faker.string.uuid(), name: 'Test' };
      queryBus.execute.mockResolvedValueOnce(output);

      const result = await controller.findOne(
        output.id,
        { id: faker.string.uuid() } as never,
      );

      expect(queryBus.execute).toHaveBeenCalledOnce();
      expect(result).toEqual(output);
    });
  });
});
```

### DTO spec template

```typescript
// infrastructure/controllers/dtos/__tests__/create-<context>.request.dto.spec.ts
import { describe, it, expect } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { Create<Context>RequestDto } from '../create-<context>.request.dto';

async function validateDto(plain: object) {
  const dto = plainToInstance(Create<Context>RequestDto, plain);
  return validate(dto);
}

describe('Create<Context>RequestDto', () => {
  it('passes validation for valid input', async () => {
    const errors = await validateDto({ name: 'Test <Context>' });
    expect(errors).toHaveLength(0);
  });

  it('fails when name is missing', async () => {
    const errors = await validateDto({});
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('fails when name is empty string', async () => {
    const errors = await validateDto({ name: '' });
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('fails when name is not a string', async () => {
    const errors = await validateDto({ name: 42 });
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });
});
```
