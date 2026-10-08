import { IEvent } from '@nestjs/cqrs';

export class NestOrderCreatedEvent implements IEvent {
  constructor(public readonly orderId: string) {}
}
