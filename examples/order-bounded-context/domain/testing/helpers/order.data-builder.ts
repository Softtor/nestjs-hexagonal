import { faker } from '@faker-js/faker';
import type { OrderItem, OrderProps } from '../../entities/order.entity';
import { OrderStatusEnum, OrderStatusVO } from '../../value-objects/order-status.vo';
import { MoneyVO } from '../../value-objects/money.vo';

/**
 * Builds a valid OrderItem with realistic fake data.
 * Override any field via the overrides parameter.
 */
export function OrderItemDataBuilder(overrides: Partial<OrderItem> = {}): OrderItem {
  const quantity = overrides.quantity ?? faker.number.int({ min: 1, max: 10 });
  const unitPrice =
    overrides.unitPrice ?? parseFloat(faker.commerce.price({ min: 5, max: 500 }));

  return {
    productId: overrides.productId ?? faker.string.uuid(),
    name: overrides.name ?? faker.commerce.productName(),
    quantity,
    unitPrice,
  };
}

type CreateOrderInput = Omit<OrderProps, 'status' | 'total' | 'createdAt' | 'updatedAt'>;

/**
 * Builds valid props for OrderEntity.create().
 * Generates a single item by default so the total is always > 0.
 */
export function OrderDataBuilder(overrides: Partial<CreateOrderInput> = {}): CreateOrderInput {
  const currency = overrides.currency ?? 'USD';
  const items = overrides.items ?? [OrderItemDataBuilder()];

  return {
    organizationId: overrides.organizationId ?? faker.string.uuid(),
    customerId: overrides.customerId ?? faker.string.uuid(),
    customerName: overrides.customerName ?? faker.person.fullName(),
    items,
    currency,
    notes: overrides.notes,
  };
}

/**
 * Builds full OrderProps for OrderEntity.restore() including a PAID status.
 * Useful for testing handlers that act on already-paid orders.
 */
export function PaidOrderDataBuilder(overrides: Partial<OrderProps> = {}): OrderProps {
  const currency = overrides.currency ?? 'USD';
  const items = overrides.items ?? [OrderItemDataBuilder()];
  const total =
    overrides.total ??
    MoneyVO.of(
      items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0),
      currency,
    );

  return {
    organizationId: overrides.organizationId ?? faker.string.uuid(),
    customerId: overrides.customerId ?? faker.string.uuid(),
    customerName: overrides.customerName ?? faker.person.fullName(),
    items,
    status: overrides.status ?? OrderStatusVO.from(OrderStatusEnum.PAID),
    total,
    currency,
    notes: overrides.notes,
    createdAt: overrides.createdAt ?? faker.date.recent({ days: 7 }),
    updatedAt: overrides.updatedAt,
  };
}

/**
 * Builds full OrderProps for OrderEntity.restore() with CANCELLED status.
 */
export function CancelledOrderDataBuilder(overrides: Partial<OrderProps> = {}): OrderProps {
  const currency = overrides.currency ?? 'USD';
  const items = overrides.items ?? [OrderItemDataBuilder()];
  const total =
    overrides.total ??
    MoneyVO.of(
      items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0),
      currency,
    );

  return {
    organizationId: overrides.organizationId ?? faker.string.uuid(),
    customerId: overrides.customerId ?? faker.string.uuid(),
    customerName: overrides.customerName ?? faker.person.fullName(),
    items,
    status: overrides.status ?? OrderStatusVO.from(OrderStatusEnum.CANCELLED),
    total,
    currency,
    cancellationReason: overrides.cancellationReason ?? 'Customer changed their mind',
    createdAt: overrides.createdAt ?? faker.date.recent({ days: 14 }),
    updatedAt: overrides.updatedAt,
  };
}
