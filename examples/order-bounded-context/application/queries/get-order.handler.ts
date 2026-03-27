import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  ORDER_REPOSITORY_TOKEN,
  OrderRepository,
} from '../../domain/repositories/order.repository';
import { OrderNotFoundError } from '../../domain/errors/order-not-found.error';
import { OrderOutputMapper, type OrderOutputDto } from '../dtos/order-output.mapper';
import { GetOrderQuery } from './get-order.query';

@QueryHandler(GetOrderQuery)
export class GetOrderHandler implements IQueryHandler<GetOrderQuery, OrderOutputDto> {
  constructor(
    @Inject(ORDER_REPOSITORY_TOKEN)
    private readonly repository: OrderRepository.Repository,
  ) {}

  async execute(query: GetOrderQuery): Promise<OrderOutputDto> {
    const order = await this.repository.findById(query.orderId);

    if (!order || order.organizationId !== query.organizationId) {
      throw new OrderNotFoundError(query.orderId);
    }

    return OrderOutputMapper.toOutput(order);
  }
}
