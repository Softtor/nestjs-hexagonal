import { Inject } from '@nestjs/common';
import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';
import { OrderEntity } from '../../domain/entities/order.entity';
import { ORDER_REPOSITORY_TOKEN, OrderRepository } from '../../domain/repositories/order.repository';
import { CreateOrderCommand } from './create-order.command';

@CommandHandler(CreateOrderCommand)
export class CreateOrderHandler implements ICommandHandler<CreateOrderCommand, { id: string }> {
  constructor(
    @Inject(ORDER_REPOSITORY_TOKEN) private readonly repository: OrderRepository.Repository,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: CreateOrderCommand): Promise<{ id: string }> {
    const order = OrderEntity.create({ organizationId: command.organizationId, items: command.items });
    this.publisher.mergeObjectContext(order);
    await this.repository.save(order);
    order.commit();
    return { id: order.id };
  }
}
