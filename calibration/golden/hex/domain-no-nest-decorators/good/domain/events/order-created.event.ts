import { IEvent } from '@nestjs/cqrs';

export class OrderCreatedEvent implements IEvent {
  constructor(public readonly total: number, public readonly occurredOn: Date = new Date()) {}
}
