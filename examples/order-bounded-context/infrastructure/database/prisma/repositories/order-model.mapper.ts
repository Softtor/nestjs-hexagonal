import { OrderEntity, type OrderItem } from '../../../../domain/entities/order.entity';
import { OrderStatusVO } from '../../../../domain/value-objects/order-status.vo';
import { MoneyVO } from '../../../../domain/value-objects/money.vo';

/**
 * Prisma model shape — mirrors the database row.
 * In a real project this would be imported from @prisma/client.
 */
export interface OrderModel {
  id: string;
  organizationId: string;
  customerId: string;
  customerName: string;
  items: OrderItem[];
  status: string;
  totalAmount: number;
  currency: string;
  notes: string | null;
  cancellationReason: string | null;
  createdAt: Date;
  updatedAt: Date | null;
}

export class OrderModelMapper {
  /**
   * Converts a raw Prisma row into a domain entity.
   * Uses restore() so no events are emitted — this is a read path.
   */
  static toEntity(model: OrderModel): OrderEntity {
    return OrderEntity.restore(
      {
        organizationId: model.organizationId,
        customerId: model.customerId,
        customerName: model.customerName,
        items: model.items,
        status: OrderStatusVO.from(model.status),
        total: MoneyVO.of(model.totalAmount, model.currency),
        currency: model.currency,
        notes: model.notes ?? undefined,
        cancellationReason: model.cancellationReason ?? undefined,
        createdAt: model.createdAt,
        updatedAt: model.updatedAt ?? undefined,
      },
      model.id,
    );
  }

  /**
   * Flattens a domain entity into a plain object suitable for Prisma's
   * create/update data argument. No events — pure serialization.
   */
  static toModel(entity: OrderEntity): Omit<OrderModel, 'updatedAt'> & { updatedAt: Date } {
    return {
      id: entity.id,
      organizationId: entity.organizationId,
      customerId: entity.customerId,
      customerName: entity.customerName,
      items: entity.items,
      status: entity.status.value,
      totalAmount: entity.total.amount,
      currency: entity.currency,
      notes: entity.notes ?? null,
      cancellationReason: entity.cancellationReason ?? null,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt ?? new Date(),
    };
  }
}
