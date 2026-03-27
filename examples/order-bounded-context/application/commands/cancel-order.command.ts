import { Command } from '@nestjs/cqrs';

export class CancelOrderCommand extends Command<void> {
  constructor(
    public readonly orderId: string,
    public readonly organizationId: string,
    public readonly reason: string,
  ) {
    super();
  }
}
