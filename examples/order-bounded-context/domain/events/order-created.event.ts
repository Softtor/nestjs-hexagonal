import { DomainEvent } from '@/shared/base-classes/domain-event';

export class OrderCreatedEvent extends DomainEvent {
  constructor(
    aggregateId: string,
    public readonly organizationId: string,
    public readonly customerId: string,
    public readonly total: number,
    public readonly currency: string,
    public readonly itemCount: number,
    occurredOn: Date = new Date(),
  ) { super('order.created', aggregateId, occurredOn); }
}
