import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';
import { CancelOrderCommand } from './cancel-order.command';

@CommandHandler(CancelOrderCommand)
export class CancelOrderHandler implements ICommandHandler<CancelOrderCommand, void> {
  constructor(private readonly publisher: EventPublisher) {}

  async execute(command: CancelOrderCommand): Promise<void> {
    void command;
  }
}
