import { DomainEvent } from '@/shared/base-classes/domain-event';

export class OrderCreatedEvent extends DomainEvent {
  constructor(public readonly total: number, aggregateId: string) {
    super('orders.Order.OrderCreated', aggregateId);
  }
}
