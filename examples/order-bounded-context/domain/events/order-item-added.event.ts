import { DomainEvent } from '@/shared/base-classes/domain-event';

export class OrderItemAddedEvent extends DomainEvent {
  constructor(
    aggregateId: string,
    public readonly productId: string,
    public readonly quantity: number,
    public readonly newTotal: number,
    occurredOn: Date = new Date(),
  ) { super('order.item-added', aggregateId, occurredOn); }
}
