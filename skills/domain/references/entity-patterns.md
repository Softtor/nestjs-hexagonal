# Entity Patterns

Entities are the core building blocks of a bounded context. Each entity extends `Entity` from `@/shared/base-classes/entity`, which is pure TypeScript and owns a pending event queue.

## Event Lifecycle — Critical Understanding

`this.apply(event)` inside an entity method does **not** publish the event. It queues the event in `Entity`'s internal list. The actual dispatch happens later, in the **command handler**, when `await events.from(entity).publish()` is called.

```
1. Entity.create(props)
       └─ internally: this.apply(new XCreatedEvent(...))   ← queued, not published

2. Handler calls: await repo.save(entity)                  ← pure persistence
3. Transaction commits                                    ← actual database commit
4. Handler calls: await events.from(entity).publish()      ← snapshot published via adapter
5. EventBus adapter hands instances to @EventsHandler listeners
```

Rules that follow from this:
- The entity never calls `publish()` on itself
- The repository never calls `publish()` or reads events — it is pure persistence
- The handler is responsible for the full lifecycle: persist + transaction commit + publish
- `restore()` never queues events (it is for DB hydration, not new domain activity)

---

## Full Entity Template

```typescript
// domain/entities/order.entity.ts
import { Entity } from '@/shared/base-classes/entity';
import { InvalidArgumentError } from '@/shared/domain-errors/errors';
import { OrderPlacedEvent } from '../events/order-placed.event';
import { OrderConfirmedEvent } from '../events/order-confirmed.event';
import { OrderCancelledEvent } from '../events/order-cancelled.event';
import { OrderStatusVO } from '../value-objects/order-status.vo';
import { OrderValidatorFactory } from '../validators/order.validator';
import { EntityValidationError } from '@/shared/domain-errors/validation-error';

export interface OrderProps {
  tenantId: string;
  customerId: string;
  status: OrderStatusVO;
  totalAmount: number;
  notes?: string;
  confirmedAt?: Date;
  cancelledAt?: Date;
  createdAt: Date;
  updatedAt?: Date;
}

export class OrderEntity extends Entity<OrderProps> {
  private constructor(props: OrderProps, id?: string) {
    super(props, id);
  }

  // ---------------------------------------------------------------------------
  // Factories
  // ---------------------------------------------------------------------------

  /**
   * Factory for NEW orders.
   * Initialises defaults and queues OrderPlacedEvent via this.apply().
   * The event is NOT published here — the handler calls events.from(entity).publish() for that.
   */
  static create(
    input: {
      tenantId: string;
      customerId: string;
      totalAmount: number;
      notes?: string;
    },
    id?: string,
  ): OrderEntity {
    const props: OrderProps = {
      tenantId: input.tenantId,
      customerId: input.customerId,
      totalAmount: input.totalAmount,
      notes: input.notes,
      status: OrderStatusVO.pending(),
      createdAt: new Date(),
    };

    OrderEntity.validate(props);

    const entity = new OrderEntity(props, id);
    entity.apply(new OrderPlacedEvent(entity.id, entity.props.tenantId));
    return entity;
  }

  /**
   * Factory for EXISTING orders loaded from persistence.
   * Does NOT queue any events — pure reconstruction.
   */
  static restore(props: OrderProps, id: string): OrderEntity {
    return new OrderEntity(props, id);
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  static validate(props: OrderProps): void {
    const validator = OrderValidatorFactory.create();
    if (!validator.validate(props)) {
      throw new EntityValidationError(validator.errors);
    }
  }

  // ---------------------------------------------------------------------------
  // Mutating methods
  // ---------------------------------------------------------------------------

  confirm(): void {
    if (!this.props.status.canConfirm()) {
      throw new InvalidArgumentError(
        `Order ${this.id} cannot be confirmed from status ${this.props.status.value}`,
      );
    }
    this.props.status = this.props.status.transitionTo('CONFIRMED');
    this.props.confirmedAt = new Date();
    this.touch();
    this.apply(new OrderConfirmedEvent(this.id, this.props.tenantId));
  }

  cancel(reason: string): void {
    if (!this.props.status.canCancel()) {
      throw new InvalidArgumentError(
        `Order ${this.id} cannot be cancelled from status ${this.props.status.value}`,
      );
    }
    this.props.status = this.props.status.transitionTo('CANCELLED');
    this.props.cancelledAt = new Date();
    this.props.notes = reason;
    this.touch();
    this.apply(new OrderCancelledEvent(this.id, this.props.tenantId, reason));
  }

  updateNotes(notes: string): void {
    this.props.notes = notes;
    this.touch();
    // No event — notes change is not a meaningful domain event here
  }

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  get tenantId(): string               { return this.props.tenantId; }
  get customerId(): string             { return this.props.customerId; }
  get status(): OrderStatusVO          { return this.props.status; }
  get totalAmount(): number            { return this.props.totalAmount; }
  get notes(): string | undefined      { return this.props.notes; }
  get confirmedAt(): Date | undefined  { return this.props.confirmedAt; }
  get cancelledAt(): Date | undefined  { return this.props.cancelledAt; }
  get createdAt(): Date                { return this.props.createdAt; }
  get updatedAt(): Date | undefined    { return this.props.updatedAt; }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  toJSON(): Required<{ id: string } & OrderProps> {
    return {
      ...super.toJSON(),
      status: this.props.status as unknown as OrderStatusVO,
    };
  }
}
```

---

## Child Entities (not aggregate roots)

Child entities belong to an aggregate but are not aggregate roots themselves. They are plain classes identified by a `UniqueEntityID`. They do not apply events — the parent aggregate applies events on their behalf.

```typescript
// domain/entities/order-item.entity.ts
import { UniqueEntityID } from '@/shared/base-classes/unique-entity-id';

export interface OrderItemProps {
  productId: string;
  quantity: number;
  unitPrice: number;
}

export class OrderItemEntity {
  public readonly _id: UniqueEntityID;

  constructor(
    public readonly props: OrderItemProps,
    id?: string,
  ) {
    this._id = new UniqueEntityID(id);
  }

  static create(props: OrderItemProps): OrderItemEntity {
    if (props.quantity <= 0) throw new InvalidArgumentError('Quantity must be positive');
    if (props.unitPrice < 0) throw new InvalidArgumentError('Unit price cannot be negative');
    return new OrderItemEntity(props);
  }

  static restore(props: OrderItemProps, id: string): OrderItemEntity {
    return new OrderItemEntity(props, id);
  }

  get id(): string        { return this._id.toString(); }
  get productId(): string { return this.props.productId; }
  get quantity(): number  { return this.props.quantity; }
  get unitPrice(): number { return this.props.unitPrice; }
  get subtotal(): number  { return this.props.quantity * this.props.unitPrice; }
}
```

---

## Entity Test Template

```typescript
// domain/entities/__tests__/unit/order.entity.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';
import { OrderEntity } from '../../order.entity';
import { OrderDataBuilder } from '../../../testing/helpers/order.data-builder';
import { OrderPlacedEvent } from '../../../events/order-placed.event';
import { OrderConfirmedEvent } from '../../../events/order-confirmed.event';
import { EntityValidationError } from '@/shared/domain-errors/validation-error';

describe('OrderEntity', () => {
  describe('create()', () => {
    it('should create an entity with valid props and assign an id', () => {
      const input = OrderDataBuilder();
      const order = OrderEntity.create(input);

      expect(order.id).toBeDefined();
      expect(order.tenantId).toBe(input.tenantId);
      expect(order.customerId).toBe(input.customerId);
      expect(order.createdAt).toBeInstanceOf(Date);
    });

    it('should default status to PENDING', () => {
      const order = OrderEntity.create(OrderDataBuilder());
      expect(order.status.isPending()).toBe(true);
    });

    it('should queue an OrderPlacedEvent (not publish)', () => {
      const order = OrderEntity.create(OrderDataBuilder());
      const events = order.getUncommittedEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(OrderPlacedEvent);
    });

    it('should accept an explicit id', () => {
      const id = faker.string.uuid();
      const order = OrderEntity.create(OrderDataBuilder(), id);
      expect(order.id).toBe(id);
    });

    it('should throw EntityValidationError for invalid props', () => {
      expect(() =>
        OrderEntity.create({ ...OrderDataBuilder(), tenantId: '' }),
      ).toThrow(EntityValidationError);
    });
  });

  describe('restore()', () => {
    it('should reconstruct without queuing any events', () => {
      const props = OrderDataBuilder();
      const id = faker.string.uuid();
      const order = OrderEntity.restore(
        { ...props, status: props.status, createdAt: new Date() },
        id,
      );

      expect(order.id).toBe(id);
      expect(order.getUncommittedEvents()).toHaveLength(0);
    });
  });

  describe('confirm()', () => {
    it('should transition status to CONFIRMED and queue OrderConfirmedEvent', () => {
      const order = OrderEntity.create(OrderDataBuilder());
      order.getUncommittedEvents().forEach((event) => order.acknowledgeEvent(event)); // discard creation events in this fixture only

      order.confirm();

      expect(order.status.isConfirmed()).toBe(true);
      expect(order.confirmedAt).toBeInstanceOf(Date);

      const events = order.getUncommittedEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(OrderConfirmedEvent);
    });

    it('should throw when confirming an already-confirmed order', () => {
      const order = OrderEntity.create(OrderDataBuilder());
      order.confirm();
      expect(() => order.confirm()).toThrow();
    });
  });

  describe('cancel()', () => {
    it('should cancel a pending order and touch updatedAt', () => {
      const order = OrderEntity.create(OrderDataBuilder());
      order.getUncommittedEvents().forEach((event) => order.acknowledgeEvent(event));

      order.cancel('Customer request');

      expect(order.status.isCancelled()).toBe(true);
      expect(order.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('getters', () => {
    it('should expose all props via getters', () => {
      const input = OrderDataBuilder();
      const order = OrderEntity.create(input);

      expect(order.tenantId).toBe(input.tenantId);
      expect(order.totalAmount).toBe(input.totalAmount);
    });
  });

  describe('toJSON()', () => {
    it('should include id and all props', () => {
      const order = OrderEntity.create(OrderDataBuilder());
      const json = order.toJSON();

      expect(json).toHaveProperty('id');
      expect(json).toHaveProperty('tenantId');
      expect(json).toHaveProperty('createdAt');
    });
  });
});
```
