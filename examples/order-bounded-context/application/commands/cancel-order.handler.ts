import { Inject } from '@nestjs/common';
import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';
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
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: CancelOrderCommand): Promise<void> {
    const order = await this.repository.findById(command.orderId);

    if (!order || order.organizationId !== command.organizationId) {
      throw new OrderNotFoundError(command.orderId);
    }

    order.cancel(command.reason);

    this.publisher.mergeObjectContext(order);
    await this.repository.save(order);
    order.commit();
  }
}
