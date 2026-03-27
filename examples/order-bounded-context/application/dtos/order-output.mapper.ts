import type { OrderEntity } from '../../domain/entities/order.entity';

export interface OrderOutputDto {
  id: string;
  organizationId: string;
  customerId: string;
  customerName: string;
  items: {
    productId: string;
    name: string;
    quantity: number;
    unitPrice: number;
  }[];
  status: string;
  total: number;
  currency: string;
  notes?: string;
  cancellationReason?: string;
  createdAt: Date;
  updatedAt?: Date;
}

export interface OrderListOutputDto {
  items: OrderOutputDto[];
  total: number;
  currentPage: number;
  perPage: number;
  lastPage: number;
}

export class OrderOutputMapper {
  static toOutput(order: OrderEntity): OrderOutputDto {
    return {
      id: order.id,
      organizationId: order.organizationId,
      customerId: order.customerId,
      customerName: order.customerName,
      items: order.items,
      status: order.status.value,
      total: order.total.amount,
      currency: order.currency,
      notes: order.notes,
      cancellationReason: order.cancellationReason,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }
}
