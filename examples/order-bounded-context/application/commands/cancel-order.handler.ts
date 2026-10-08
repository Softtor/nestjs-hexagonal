import type { EventDispatcher } from '@/shared/events/event-dispatcher';
import { EVENT_DISPATCHER_TOKEN } from '@/shared/events/event-publisher.port';
import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import {
  ORDER_REPOSITORY_TOKEN,
  OrderRepository,
} from '../../domain/repositories/order.repository';
import { OrderNotFoundError } from '../../domain/errors/order-not-found.error';
import { CancelOrderCommand } from './cancel-order.command';

@CommandHandler(CancelOrderCommand)
export class CancelOrderHandler implements ICommandHandler<CancelOrderCommand, void> {
  constructor(
    @Inject(ORDER_REPOSITORY_TOKEN)
    private readonly repository: OrderRepository.Repository,
    @Inject(EVENT_DISPATCHER_TOKEN)
    private readonly events: EventDispatcher,
  ) {}

  async execute(command: CancelOrderCommand): Promise<void> {
    const order = await this.repository.findById(command.orderId);

    if (!order || order.organizationId !== command.organizationId) {
      throw new OrderNotFoundError(command.orderId);
    }

    order.cancel(command.reason);

    await this.repository.save(order);
    await this.events.from(order).publish();
  }
}
