import type { EventDispatcher } from '@/shared/events/event-dispatcher';
import { EVENT_DISPATCHER_TOKEN } from '@/shared/events/event-publisher.port';
import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
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
    @Inject(EVENT_DISPATCHER_TOKEN)
    private readonly events: EventDispatcher,
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

    await this.repository.save(order);
    await this.events.from(order).publish();

    return { id: order.id };
  }
}
