import { IEvent } from '@nestjs/cqrs';

export class OrderCreatedEvent implements IEvent {
  constructor(
    public readonly aggregateId: string,
    public readonly organizationId: string,
    public readonly customerId: string,
    public readonly total: number,
    public readonly currency: string,
    public readonly itemCount: number,
    public readonly occurredOn: Date = new Date(),
  ) {}
}
