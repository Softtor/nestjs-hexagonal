import { DomainEvent } from '@/shared/base-classes/domain-event';

export class OrderCancelledEvent extends DomainEvent {
  constructor(
    aggregateId: string,
    public readonly organizationId: string,
    public readonly customerId: string,
    public readonly reason: string,
    occurredOn: Date = new Date(),
  ) { super('order.cancelled', aggregateId, occurredOn); }
}
