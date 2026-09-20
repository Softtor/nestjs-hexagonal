import { Inject, Injectable } from '@nestjs/common';
import { ORDER_REPOSITORY_TOKEN, OrderRepository } from '../../domain/repositories/order.repository';

@Injectable()
export class OrderLookupAdapter {
  constructor(@Inject(ORDER_REPOSITORY_TOKEN) private readonly orderRepository: OrderRepository.Repository) {}

  async exists(id: string): Promise<boolean> {
    return (await this.orderRepository.findById(id)) !== null;
  }
}
