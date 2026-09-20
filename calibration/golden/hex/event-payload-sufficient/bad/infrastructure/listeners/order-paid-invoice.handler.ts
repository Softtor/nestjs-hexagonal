import { Inject } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { OrderPaidEvent } from '../../domain/events/order-paid.event';
import { ORDER_REPOSITORY_TOKEN, OrderRepository } from '../../domain/repositories/order.repository';

@EventsHandler(OrderPaidEvent)
export class OrderPaidInvoiceHandler implements IEventHandler<OrderPaidEvent> {
  constructor(@Inject(ORDER_REPOSITORY_TOKEN) private readonly orderRepository: OrderRepository.Repository) {}

  async handle(event: OrderPaidEvent): Promise<void> {
    const order = await this.orderRepository.findById(event.aggregateId);
    if (!order) {
      return;
    }
  }
}
