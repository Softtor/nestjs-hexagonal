import { Entity } from '@/shared/base-classes/entity';
import { OrderStatusEnum, OrderStatusVO } from '../value-objects/order-status.vo';
import { MoneyVO } from '../value-objects/money.vo';
import { OrderCreatedEvent } from '../events/order-created.event';
import { OrderPaidEvent } from '../events/order-paid.event';
import { OrderCancelledEvent } from '../events/order-cancelled.event';
import { OrderItemAddedEvent } from '../events/order-item-added.event';
import { InvalidOrderStatusTransitionError } from '../errors/invalid-order-status-transition.error';

export interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface OrderProps {
  organizationId: string;
  customerId: string;
  customerName: string;
  items: OrderItem[];
  status: OrderStatusVO;
  total: MoneyVO;
  currency: string;
  notes?: string;
  cancellationReason?: string;
  createdAt: Date;
  updatedAt?: Date;
}

export class OrderEntity extends Entity<OrderProps> {
  private constructor(props: OrderProps, id?: string) {
    super(props, id);
  }

  // ---------------------------------------------------------------------------
  // Factory methods
  // ---------------------------------------------------------------------------

  /**
   * Creates a new order and emits OrderCreatedEvent.
   * The total is calculated from the items provided.
   */
  static create(
    input: Omit<OrderProps, 'status' | 'total' | 'createdAt' | 'updatedAt'>,
    id?: string,
  ): OrderEntity {
    const status = OrderStatusVO.pending();
    const total = OrderEntity.calculateTotal(input.items, input.currency);
    const entity = new OrderEntity(
      {
        ...input,
        status,
        total,
        createdAt: new Date(),
      },
      id,
    );

    entity.apply(
      new OrderCreatedEvent(
        entity.id,
        input.organizationId,
        input.customerId,
        total.amount,
        input.currency,
        input.items.length,
      ),
    );

    return entity;
  }

  /**
   * Restores an existing order from persistence — emits no events.
   * Used by the Prisma mapper when hydrating from the database.
   */
  static restore(props: OrderProps, id: string): OrderEntity {
    return new OrderEntity(props, id);
  }

  // ---------------------------------------------------------------------------
  // Business methods
  // ---------------------------------------------------------------------------

  /**
   * Adds an item to the order and recalculates the total.
   * Only allowed when the order is still PENDING.
   */
  addItem(item: OrderItem): void {
    if (!this.props.status.isPending()) {
      throw new InvalidOrderStatusTransitionError(
        this.props.status.value,
        'adding items is only allowed on PENDING orders',
      );
    }

    this.props.items.push(item);
    this.props.total = OrderEntity.calculateTotal(this.props.items, this.props.currency);
    this.touch();

    this.apply(
      new OrderItemAddedEvent(
        this.id,
        item.productId,
        item.quantity,
        this.props.total.amount,
      ),
    );
  }

  /**
   * Marks the order as paid.
   * Enforces the PENDING -> PAID transition via the status state machine.
   */
  markAsPaid(): void {
    this.props.status = this.props.status.transitionTo(OrderStatusEnum.PAID);
    this.touch();

    this.apply(
      new OrderPaidEvent(
        this.id,
        this.props.organizationId,
        this.props.customerId,
        this.props.total.amount,
        this.props.currency,
      ),
    );
  }

  /**
   * Cancels the order with a mandatory reason.
   * Allowed from PENDING or PAID states only.
   */
  cancel(reason: string): void {
    this.props.status = this.props.status.transitionTo(OrderStatusEnum.CANCELLED);
    this.props.cancellationReason = reason;
    this.touch();

    this.apply(
      new OrderCancelledEvent(
        this.id,
        this.props.organizationId,
        this.props.customerId,
        reason,
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  get organizationId(): string {
    return this.props.organizationId;
  }

  get customerId(): string {
    return this.props.customerId;
  }

  get customerName(): string {
    return this.props.customerName;
  }

  get items(): OrderItem[] {
    return [...this.props.items];
  }

  get status(): OrderStatusVO {
    return this.props.status;
  }

  get total(): MoneyVO {
    return this.props.total;
  }

  get currency(): string {
    return this.props.currency;
  }

  get notes(): string | undefined {
    return this.props.notes;
  }

  get cancellationReason(): string | undefined {
    return this.props.cancellationReason;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date | undefined {
    return this.props.updatedAt;
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  toJSON() {
    return {
      id: this.id,
      organizationId: this.props.organizationId,
      customerId: this.props.customerId,
      customerName: this.props.customerName,
      items: this.props.items,
      status: this.props.status.value,
      total: this.props.total.amount,
      currency: this.props.currency,
      notes: this.props.notes,
      cancellationReason: this.props.cancellationReason,
      createdAt: this.props.createdAt,
      updatedAt: this.props.updatedAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private static calculateTotal(items: OrderItem[], currency: string): MoneyVO {
    return items.reduce(
      (acc, item) => acc.add(MoneyVO.of(item.unitPrice * item.quantity, currency)),
      MoneyVO.zero(currency),
    );
  }
}
