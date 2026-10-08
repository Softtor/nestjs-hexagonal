import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { EventDispatcher } from '@/shared/events/event-dispatcher';

@CommandHandler(DispatchOrderCommand)
export class DispatchOrderHandler implements ICommandHandler<DispatchOrderCommand> {
  constructor(private readonly events: EventDispatcher, private readonly repository: OrderRepository) {}

  async execute(command: DispatchOrderCommand): Promise<void> {
    const order = await this.repository.findById(command.orderId);
    if (!order) throw new NotFoundError(command.orderId);
    order.dispatch();
    await this.repository.save(order);
    await this.events.from(order).publish();
  }
}
