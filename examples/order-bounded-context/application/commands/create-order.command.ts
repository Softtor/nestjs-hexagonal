import { Command } from '@nestjs/cqrs';
import type { CreateOrderDto } from '../dtos/create-order.dto';

export class CreateOrderCommand extends Command<CreateOrderDto.Output> {
  constructor(
    public readonly organizationId: string,
    public readonly customerId: string,
    public readonly customerName: string,
    public readonly items: {
      productId: string;
      name: string;
      quantity: number;
      unitPrice: number;
    }[],
    public readonly currency: string,
    public readonly notes?: string,
  ) {
    super();
  }
}
