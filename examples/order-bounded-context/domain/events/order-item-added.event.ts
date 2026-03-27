import { IEvent } from '@nestjs/cqrs';

export class OrderItemAddedEvent implements IEvent {
  constructor(
    public readonly aggregateId: string,
    public readonly productId: string,
    public readonly quantity: number,
    public readonly newTotal: number,
    public readonly occurredOn: Date = new Date(),
  ) {}
}
