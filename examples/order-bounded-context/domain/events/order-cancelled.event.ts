import { IEvent } from '@nestjs/cqrs';

export class OrderCancelledEvent implements IEvent {
  constructor(
    public readonly aggregateId: string,
    public readonly organizationId: string,
    public readonly customerId: string,
    public readonly reason: string,
    public readonly occurredOn: Date = new Date(),
  ) {}
}
