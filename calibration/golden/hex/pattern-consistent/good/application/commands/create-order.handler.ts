import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';
import { CreateOrderCommand } from './create-order.command';

@CommandHandler(CreateOrderCommand)
export class CreateOrderHandler implements ICommandHandler<CreateOrderCommand, { id: string }> {
  constructor(private readonly publisher: EventPublisher) {}

  async execute(command: CreateOrderCommand): Promise<{ id: string }> {
    void command;
    return { id: 'order-1' };
  }
}
