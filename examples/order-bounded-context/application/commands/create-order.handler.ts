import { Inject } from '@nestjs/common';
import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';
import { OrderEntity } from '../../domain/entities/order.entity';
import {
  ORDER_REPOSITORY_TOKEN,
  OrderRepository,
} from '../../domain/repositories/order.repository';
import type { CreateOrderDto } from '../dtos/create-order.dto';
import { CreateOrderCommand } from './create-order.command';

@CommandHandler(CreateOrderCommand)
export class CreateOrderHandler
  implements ICommandHandler<CreateOrderCommand, CreateOrderDto.Output>
{
  constructor(
    @Inject(ORDER_REPOSITORY_TOKEN)
    private readonly repository: OrderRepository.Repository,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: CreateOrderCommand): Promise<CreateOrderDto.Output> {
    const order = OrderEntity.create({
      organizationId: command.organizationId,
      customerId: command.customerId,
      customerName: command.customerName,
      items: command.items,
      currency: command.currency,
      notes: command.notes,
    });

    // mergeObjectContext wires the entity's EventBus before we persist.
    // commit() must be called AFTER save so that listeners see persisted data.
    this.publisher.mergeObjectContext(order);
    await this.repository.save(order);
    order.commit();

    return { id: order.id };
  }
}
