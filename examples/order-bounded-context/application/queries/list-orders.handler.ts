import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  ORDER_REPOSITORY_TOKEN,
  OrderRepository,
} from '../../domain/repositories/order.repository';
import {
  OrderOutputMapper,
  type OrderListOutputDto,
} from '../dtos/order-output.mapper';
import { ListOrdersQuery } from './list-orders.query';

@QueryHandler(ListOrdersQuery)
export class ListOrdersHandler
  implements IQueryHandler<ListOrdersQuery, OrderListOutputDto>
{
  constructor(
    @Inject(ORDER_REPOSITORY_TOKEN)
    private readonly repository: OrderRepository.Repository,
  ) {}

  async execute(query: ListOrdersQuery): Promise<OrderListOutputDto> {
    const params = new OrderRepository.SearchParams({
      page: query.page,
      perPage: query.perPage,
      sort: 'createdAt',
      sortDir: 'desc',
      filter: {
        organizationId: query.organizationId,
        status: query.status,
        customerId: query.customerId,
      },
    });

    const result = await this.repository.search(params);

    return {
      items: result.items.map(OrderOutputMapper.toOutput),
      total: result.total,
      currentPage: result.currentPage,
      perPage: result.perPage,
      lastPage: result.lastPage,
    };
  }
}
