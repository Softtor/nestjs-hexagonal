import { ValueObject } from '@/shared/base-classes/value-object';
import { InvalidOrderStatusTransitionError } from '../errors/invalid-order-status-transition.error';
import { InvalidArgumentError } from '@/shared/domain-errors/errors';

export enum OrderStatusEnum {
  PENDING = 'PENDING',
  PAID = 'PAID',
  SHIPPED = 'SHIPPED',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

// State machine: only explicitly listed transitions are allowed.
const ALLOWED_TRANSITIONS: Record<OrderStatusEnum, OrderStatusEnum[]> = {
  [OrderStatusEnum.PENDING]: [OrderStatusEnum.PAID, OrderStatusEnum.CANCELLED],
  [OrderStatusEnum.PAID]: [OrderStatusEnum.SHIPPED, OrderStatusEnum.CANCELLED],
  [OrderStatusEnum.SHIPPED]: [OrderStatusEnum.DELIVERED],
  [OrderStatusEnum.DELIVERED]: [],
  [OrderStatusEnum.CANCELLED]: [],
};

export class OrderStatusVO extends ValueObject<OrderStatusEnum> {
  private constructor(value: OrderStatusEnum) {
    super(value);
  }

  protected validate(): void {
    if (!Object.values(OrderStatusEnum).includes(this._value)) {
      throw new InvalidArgumentError(`Invalid order status: "${this._value}"`);
    }
  }

  static pending(): OrderStatusVO {
    return new OrderStatusVO(OrderStatusEnum.PENDING);
  }

  static from(value: string): OrderStatusVO {
    return new OrderStatusVO(value as OrderStatusEnum);
  }

  canTransitionTo(target: OrderStatusEnum): boolean {
    return ALLOWED_TRANSITIONS[this._value].includes(target);
  }

  transitionTo(target: OrderStatusEnum): OrderStatusVO {
    if (!this.canTransitionTo(target)) {
      throw new InvalidOrderStatusTransitionError(this._value, target);
    }
    return new OrderStatusVO(target);
  }

  isPending(): boolean {
    return this._value === OrderStatusEnum.PENDING;
  }

  isPaid(): boolean {
    return this._value === OrderStatusEnum.PAID;
  }

  isShipped(): boolean {
    return this._value === OrderStatusEnum.SHIPPED;
  }

  isDelivered(): boolean {
    return this._value === OrderStatusEnum.DELIVERED;
  }

  isCancelled(): boolean {
    return this._value === OrderStatusEnum.CANCELLED;
  }

  isFinal(): boolean {
    return this.isDelivered() || this.isCancelled();
  }
}
