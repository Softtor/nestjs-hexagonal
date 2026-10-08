import { DomainEvent } from '@/shared/base-classes/domain-event';

export class OrderPaidEvent extends DomainEvent {
  constructor(
    aggregateId: string,
    public readonly organizationId: string,
    public readonly customerId: string,
    public readonly total: number,
    public readonly currency: string,
    occurredOn: Date = new Date(),
  ) { super('order.paid', aggregateId, occurredOn); }
}
