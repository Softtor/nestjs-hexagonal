---
name: domain
description: Use when creating domain layer artifacts for a NestJS bounded context — entities (AggregateRoot), value objects, domain events, repository interfaces, domain services, validators, or data builders. Covers Hexagonal Architecture + DDD patterns with NestJS CQRS native event support.
argument-hint: Artifact type or entity name (e.g., "entity Order", "vo OrderStatus", "event OrderCreated")
---

# Domain Layer

The domain layer contains the pure business logic of a bounded context. It has zero framework dependencies except `@nestjs/cqrs` for `AggregateRoot` (entity base class). No `@Injectable`, no `PrismaService`, no HTTP concerns.

---

## Decision Tree

What are you creating?

```
Domain artifact needed?
│
├── An entity (aggregate root with lifecycle methods)
│   └── Go to: Entity Pattern
│
├── A simple value (email, amount, name, phone)
│   └── Go to: VO — Scalar
│
├── A grouped value (address, bank details, money)
│   └── Go to: VO — Composed
│
├── A fixed set of values (payment method, channel type)
│   └── Go to: VO — Enum
│
├── A status with allowed transitions (order status, withdrawal status)
│   └── Go to: VO — State Machine
│
├── The persistence contract for the entity
│   └── Go to: Repository Interface
│
├── Something that happened in the domain
│   └── Go to: Domain Events
│
├── Logic that belongs to the domain but not to one entity
│   └── Go to: Domain Services
│
├── A domain-specific error with context
│   └── Go to: Domain Errors
│
├── Entity invariant enforcement (field-level rules)
│   └── Go to: Validators
│
└── Fake data for tests
    └── Go to: Data Builders
```

---

## Entity Pattern

Full reference: `references/entity-patterns.md`

An entity is identified by its `UniqueEntityID`, not by its value. It extends `AggregateRoot` from `@nestjs/cqrs` so that events flow through the NestJS `EventBus` once committed.

**Two factory methods are mandatory:**

- `static create(props, id?)` — for new instances; calls `this.apply(new XCreatedEvent(...))`
- `static restore(props, id)` — for DB hydration; emits no events

**Event lifecycle** (every entity follows this):
```
entity.apply(event)            // 1. records the event in memory
publisher.mergeObjectContext(entity)  // 2. wires EventBus (in handler)
await repo.save(entity)        // 3. persists
entity.commit()                // 4. publishes events to EventBus
```

**Condensed template:**

```typescript
// domain/entities/<name>.entity.ts
import { Entity } from '@/shared/base-classes/entity';
import { <Name>CreatedEvent } from '../events/<name>-created.event';

export interface <Name>Props {
  tenantId: string;
  // ... business fields
  createdAt: Date;
  updatedAt?: Date;
}

export class <Name>Entity extends Entity<<Name>Props> {
  private constructor(props: <Name>Props, id?: string) {
    super(props, id);
  }

  static create(
    input: Omit<<Name>Props, 'createdAt' | 'updatedAt'>,
    id?: string,
  ): <Name>Entity {
    const entity = new <Name>Entity({ ...input, createdAt: new Date() }, id);
    entity.apply(new <Name>CreatedEvent(entity.id));
    return entity;
  }

  static restore(props: <Name>Props, id: string): <Name>Entity {
    return new <Name>Entity(props, id);
  }

  // Mutating method
  update(name: string): void {
    this.props.name = name;
    this.touch();
    this.apply(new <Name>UpdatedEvent(this.id, name));
  }

  get tenantId(): string { return this.props.tenantId; }
  // ... other getters

  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date | undefined { return this.props.updatedAt; }
}
```

See `references/entity-patterns.md` for: child entities, `validate()` integration, `toJSON()` override, and the full test template.

---

## Value Object Variants

Full reference: `references/value-object-patterns.md`

All VOs extend `ValueObject<T>` from `@/shared/base-classes/value-object`. Rules:
- Constructor is `private` — only static factories create instances
- `validate()` throws on invariant violations; it is called automatically in the constructor
- Never import `@nestjs/*` or `class-validator` in a VO

### Scalar VO (single value)

```typescript
// domain/value-objects/email.vo.ts
import { ValueObject } from '@/shared/base-classes/value-object';
import { InvalidArgumentError } from '@/shared/domain-errors/errors';

export class EmailVO extends ValueObject<string> {
  private constructor(value: string) { super(value); }

  protected validate(): void {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this._value)) {
      throw new InvalidArgumentError(`Invalid email: "${this._value}"`);
    }
  }

  static create(email: string): EmailVO {
    return new EmailVO(email.toLowerCase().trim());
  }

  get domain(): string { return this._value.split('@')[1]; }
}
```

### Composed VO (multiple props)

```typescript
// domain/value-objects/address.vo.ts
import { ValueObject } from '@/shared/base-classes/value-object';
import { InvalidArgumentError } from '@/shared/domain/errors';

interface AddressProps { street: string; city: string; country: string; }

export class AddressVO extends ValueObject<AddressProps> {
  private constructor(props: AddressProps) { super(props); }

  protected validate(): void {
    if (!this._value.street) throw new InvalidArgumentError('Street is required');
    if (!this._value.city)   throw new InvalidArgumentError('City is required');
    if (!this._value.country) throw new InvalidArgumentError('Country is required');
  }

  static create(props: AddressProps): AddressVO {
    return new AddressVO(props);
  }

  get street(): string  { return this._value.street; }
  get city(): string    { return this._value.city; }
  get country(): string { return this._value.country; }
}
```

### Enum VO (fixed set of named values)

```typescript
// domain/value-objects/payment-method.vo.ts
import { ValueObject } from '@/shared/base-classes/value-object';

export enum PaymentMethodEnum { CREDIT = 'CREDIT', DEBIT = 'DEBIT', PIX = 'PIX' }

export class PaymentMethodVO extends ValueObject<PaymentMethodEnum> {
  private constructor(value: PaymentMethodEnum) { super(value); }

  protected validate(): void {
    if (!Object.values(PaymentMethodEnum).includes(this._value)) {
      throw new InvalidArgumentError(`Unknown payment method: ${this._value}`);
    }
  }

  static credit(): PaymentMethodVO { return new PaymentMethodVO(PaymentMethodEnum.CREDIT); }
  static debit():  PaymentMethodVO { return new PaymentMethodVO(PaymentMethodEnum.DEBIT); }
  static pix():    PaymentMethodVO { return new PaymentMethodVO(PaymentMethodEnum.PIX); }

  static from(value: string): PaymentMethodVO {
    return new PaymentMethodVO(value as PaymentMethodEnum);
  }

  isCredit(): boolean { return this._value === PaymentMethodEnum.CREDIT; }
  isPix(): boolean    { return this._value === PaymentMethodEnum.PIX; }
}
```

### State Machine VO (controlled transitions)

```typescript
// domain/value-objects/order-status.vo.ts
import { ValueObject } from '@/shared/base-classes/value-object';

export enum OrderStatusEnum {
  PENDING = 'PENDING', CONFIRMED = 'CONFIRMED', SHIPPED = 'SHIPPED', COMPLETED = 'COMPLETED',
}

const ALLOWED_TRANSITIONS: Record<OrderStatusEnum, OrderStatusEnum[]> = {
  [OrderStatusEnum.PENDING]:    [OrderStatusEnum.CONFIRMED],
  [OrderStatusEnum.CONFIRMED]:  [OrderStatusEnum.SHIPPED],
  [OrderStatusEnum.SHIPPED]:    [OrderStatusEnum.COMPLETED],
  [OrderStatusEnum.COMPLETED]:  [],
};

export class OrderStatusVO extends ValueObject<OrderStatusEnum> {
  private constructor(value: OrderStatusEnum) { super(value); }

  protected validate(): void {
    if (!Object.values(OrderStatusEnum).includes(this._value)) {
      throw new InvalidArgumentError(`Invalid order status: ${this._value}`);
    }
  }

  static pending():   OrderStatusVO { return new OrderStatusVO(OrderStatusEnum.PENDING); }
  static confirmed(): OrderStatusVO { return new OrderStatusVO(OrderStatusEnum.CONFIRMED); }

  static from(value: string): OrderStatusVO {
    return new OrderStatusVO(value as OrderStatusEnum);
  }

  canTransitionTo(target: OrderStatusEnum): boolean {
    return ALLOWED_TRANSITIONS[this._value].includes(target);
  }

  transitionTo(target: OrderStatusEnum): OrderStatusVO {
    if (!this.canTransitionTo(target)) {
      throw new InvalidArgumentError(
        `Cannot transition from ${this._value} to ${target}`,
      );
    }
    return new OrderStatusVO(target);
  }

  isPending():   boolean { return this._value === OrderStatusEnum.PENDING; }
  isCompleted(): boolean { return this._value === OrderStatusEnum.COMPLETED; }
}
```

See `references/value-object-patterns.md` for full VO test templates and edge-case guidance.

---

## Repository Interface

Full reference: `references/repository-interface.md`

The repository interface is the domain's **port** for persistence. It lives in `domain/repositories/`. The implementation lives in `infrastructure/`. No `@Injectable` or Prisma imports here.

```typescript
// domain/repositories/<name>.repository.ts
import type { <Name>Entity } from '../entities/<name>.entity';
import {
  SearchParams as DefaultSearchParams,
  SearchResult as DefaultSearchResult,
  SearchableRepositoryInterface,
} from '@/shared/repository-contracts/searchable-repository-contracts';

export namespace <Name>Repository {
  export type Filter = string;
  export class SearchParams extends DefaultSearchParams<Filter> {}
  export class SearchResult extends DefaultSearchResult<<Name>Entity, Filter> {}

  export interface Repository
    extends SearchableRepositoryInterface<
      <Name>Entity, Filter, SearchParams, SearchResult
    > {
    findById(id: string): Promise<<Name>Entity | null>;
    findByTenant(tenantId: string): Promise<<Name>Entity[]>;
    save(entity: <Name>Entity): Promise<void>;
    delete(id: string): Promise<void>;
  }
}

export const <NAME>_REPOSITORY = Symbol('<Name>Repository');
```

See `references/repository-interface.md` for: extended SearchParams with custom filters, domain-specific query methods, and the in-memory test double pattern.

---

## Domain Events

Full reference: `references/domain-event-patterns.md`

Domain events capture **what happened** in the domain. They implement `IEvent` from `@nestjs/cqrs`.

**Naming:** `<Entity><PastTenseVerb>Event` (e.g., `OrderPlacedEvent`, `CustomerActivatedEvent`)

```typescript
// domain/events/<name>-created.event.ts
import { IEvent } from '@nestjs/cqrs';

export class <Name>CreatedEvent implements IEvent {
  constructor(
    public readonly <name>Id: string,
    public readonly tenantId: string,
    // include all data handlers will need
  ) {}
}
```

Rules:
- Events are applied via `entity.apply(event)` inside entity methods
- The handler calls `publisher.mergeObjectContext(entity)` then `entity.commit()` to publish
- Event handlers use `@EventsHandler` + `IEventHandler` — never `@OnEvent` for new code
- Include enough payload so handlers do not need to re-fetch the entity

See `references/domain-event-patterns.md` for: full event catalog pattern, testing uncommitted events, and handler template.

---

## Domain Services

Full reference: `references/domain-service-patterns.md`

Use a domain service when a domain operation involves multiple entities or rules that do not belong to a single entity. Domain services are **pure classes** — no decorators, no DI, no I/O.

```typescript
// domain/services/<name>.service.ts
export class FeeCalculationService {
  static calculate(amount: number, feePercentage: number): number {
    if (amount <= 0) throw new InvalidArgumentError('Amount must be positive');
    return Math.round(amount * (feePercentage / 100));
  }
}
```

**When to use:**
- Logic spans two or more aggregates
- A calculation or rule is shared by multiple entity methods
- The operation is stateless and has no side effects

**When NOT to use:**
- Logic belongs clearly to a single entity → put it in the entity
- Logic requires I/O (DB, queue) → use an application service in the `application/` layer

See `references/domain-service-patterns.md` for: stateful services, integration examples, and test templates.

---

## Validators

Full reference: `references/validator-patterns.md`

Validators enforce entity invariants (field-level rules) using `class-validator` decorators on a `Rules` class, executed via `ClassValidatorFields`. This is for **domain validation only** — not for HTTP input validation.

```typescript
// domain/validators/<name>.validator.ts
import { IsString, IsNotEmpty, IsUUID, IsOptional, MaxLength } from 'class-validator';
import { ClassValidatorFields } from '@/shared/base-classes/class-validator-fields';
import type { <Name>Props } from '../entities/<name>.entity';

class <Name>Rules {
  @IsUUID() @IsNotEmpty() tenantId: string;
  @IsString() @IsNotEmpty() @MaxLength(255) name: string;
  @IsOptional() @IsString() description?: string;

  constructor(props: <Name>Props) { Object.assign(this, props); }
}

class <Name>Validator extends ClassValidatorFields<<Name>Rules> {
  validate(data: <Name>Props): boolean {
    return super.validate(new <Name>Rules(data));
  }
}

export class <Name>ValidatorFactory {
  static create(): <Name>Validator { return new <Name>Validator(); }
}
```

Usage in entity:

```typescript
static validate(props: <Name>Props): void {
  const validator = <Name>ValidatorFactory.create();
  if (!validator.validate(props)) {
    throw new EntityValidationError(validator.errors);
  }
}
```

See `references/validator-patterns.md` for: the `ClassValidatorFields` base, nested validation, and full test template.

---

## Data Builders

Full reference: `references/data-builder-patterns.md`

Data builders provide deterministic fake data for unit tests. They live in `domain/testing/helpers/`.

```typescript
// domain/testing/helpers/<name>.data-builder.ts
import { faker } from '@faker-js/faker';
import type { <Name>Props } from '../../entities/<name>.entity';

export function <Name>DataBuilder(overrides?: Partial<<Name>Props>): <Name>Props {
  return {
    tenantId: overrides?.tenantId ?? faker.string.uuid(),
    name:     overrides?.name     ?? faker.commerce.productName(),
    createdAt: overrides?.createdAt ?? new Date(),
    updatedAt: overrides?.updatedAt,
    ...overrides,
  };
}
```

See `references/data-builder-patterns.md` for: composed builders, state-specific variants (Active, Pending, Rejected), and how to wire builders into test `describe` blocks.

---

## Domain Errors

Specialized errors that extend the shared error hierarchy (`DomainError`, `NotFoundError`, `ConflictError`, etc.) with domain-specific context.

Live in `<bc>/domain/errors/`. Name convention: `<Entity><Condition>Error`.

```typescript
// domain/errors/order-not-found.error.ts
import { NotFoundError } from '@/shared/domain/errors';

export class OrderNotFoundError extends NotFoundError {
  constructor(public readonly orderId: string) {
    super(`Order ${orderId} not found`);
  }
}

// domain/errors/invalid-order-status-transition.error.ts
import { DomainError } from '@/shared/domain/errors';

export class InvalidOrderStatusTransitionError extends DomainError {
  constructor(
    public readonly currentStatus: string,
    public readonly targetStatus: string,
  ) {
    super(`Cannot transition from ${currentStatus} to ${targetStatus}`);
  }
}
```

**When to specialize:** When the error carries domain context (IDs, amounts, statuses) that helps debugging. Don't specialize if the generic message is sufficient.

See `references/domain-error-patterns.md` for: full error catalog, naming conventions, error filter mapping, testing patterns.

---

## Rules and Anti-Patterns

### What belongs in the domain layer

- Entity classes, VO classes, domain events, repository interfaces, domain service classes, validators
- Types and interfaces that describe domain concepts

### What does NOT belong here

| Anti-pattern | Correct approach |
|---|---|
| `import { Injectable } from '@nestjs/common'` | Only allowed in `infrastructure/` and `application/services/` |
| `import { PrismaService }` | Only in Prisma repository implementations |
| `import { IsEmail } from 'class-validator'` | Only in validators (not in VOs) |
| `new PrismaClient()` inside an entity | Repositories handle persistence |
| Calling another aggregate's repository | Use a domain service or application service |
| Throwing HTTP exceptions (`NotFoundException`) | Throw domain errors; HTTP mapping is in `infrastructure/` |
| `entity.addDomainEvent()` / `entity.pullDomainEvents()` | Use `entity.apply(event)` (NestJS CQRS native) |

### Event invariants

- `create()` ALWAYS calls `this.apply(new XCreatedEvent(...))`
- `restore()` NEVER emits events
- Mutating methods call `this.touch()` then `this.apply(new XUpdatedEvent(...))`
- The repository saves the entity; the CQRS handler commits events

### VO invariants

- VOs are immutable — mutating methods return a NEW VO instance
- State Machine VOs always validate transition legality in `transitionTo()`
- Enum VOs provide named static factories (`static pending()`) — callers never pass raw strings

---

## Testing

### Entity spec skeleton

```typescript
// domain/entities/__tests__/unit/<name>.entity.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { <Name>Entity } from '../../<name>.entity';
import { <Name>DataBuilder } from '../../../testing/helpers/<name>.data-builder';
import { <Name>CreatedEvent } from '../../../events/<name>-created.event';

describe('<Name>Entity', () => {
  describe('create()', () => {
    it('should create entity with valid props', () => {
      const props = <Name>DataBuilder();
      const entity = <Name>Entity.create(props);

      expect(entity.id).toBeDefined();
      expect(entity.name).toBe(props.name);
      expect(entity.createdAt).toBeInstanceOf(Date);
    });

    it('should apply <Name>CreatedEvent', () => {
      const entity = <Name>Entity.create(<Name>DataBuilder());
      const events = entity.getUncommittedEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(<Name>CreatedEvent);
    });
  });

  describe('restore()', () => {
    it('should not apply any events', () => {
      const props = <Name>DataBuilder();
      const entity = <Name>Entity.restore(props, faker.string.uuid());

      expect(entity.getUncommittedEvents()).toHaveLength(0);
    });
  });

  describe('update()', () => {
    it('should update field and touch updatedAt', () => {
      const entity = <Name>Entity.create(<Name>DataBuilder());
      entity.commit(); // clear creation event

      entity.update('new-name');

      expect(entity.name).toBe('new-name');
      expect(entity.updatedAt).toBeInstanceOf(Date);
    });
  });
});
```

### VO spec skeleton

```typescript
// domain/value-objects/__tests__/<name>.vo.spec.ts
import { describe, it, expect } from 'vitest';
import { EmailVO } from '../email.vo';

describe('EmailVO', () => {
  it('should create from valid email', () => {
    const vo = EmailVO.create('User@Example.COM');
    expect(vo.value).toBe('user@example.com');
  });

  it('should throw on invalid email', () => {
    expect(() => EmailVO.create('not-an-email')).toThrow();
  });

  it('should be equal when value matches', () => {
    expect(EmailVO.create('a@b.com').equals(EmailVO.create('a@b.com'))).toBe(true);
  });
});
```
