import { Query } from '@nestjs/cqrs';
import type { OrderOutputDto } from '../dtos/order-output.mapper';

export class GetOrderQuery extends Query<OrderOutputDto> {
  constructor(
    public readonly orderId: string,
    public readonly organizationId: string,
  ) {
    super();
  }
}
