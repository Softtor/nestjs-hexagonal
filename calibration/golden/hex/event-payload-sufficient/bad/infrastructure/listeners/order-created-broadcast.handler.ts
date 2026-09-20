import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { OrderCreatedEvent } from '../../domain/events/order-created.event';

@EventsHandler(OrderCreatedEvent)
export class OrderCreatedBroadcastHandler implements IEventHandler<OrderCreatedEvent> {
  constructor(private readonly repo: { get(id: string): Promise<unknown> }) {}

  async handle(event: OrderCreatedEvent): Promise<void> {
    const fresh = await this.repo.get(event.aggregateId);
    void fresh;
  }
}
