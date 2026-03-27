import { Query } from '@nestjs/cqrs';
import type { OrderListOutputDto } from '../dtos/order-output.mapper';
import type { OrderStatusEnum } from '../../domain/value-objects/order-status.vo';

export class ListOrdersQuery extends Query<OrderListOutputDto> {
  constructor(
    public readonly organizationId: string,
    public readonly page: number = 1,
    public readonly perPage: number = 20,
    public readonly status?: OrderStatusEnum,
    public readonly customerId?: string,
  ) {
    super();
  }
}
