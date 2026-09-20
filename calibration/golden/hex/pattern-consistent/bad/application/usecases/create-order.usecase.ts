import type { OrderRepository } from '../../domain/repositories/order.repository';

export const CREATE_ORDER_USE_CASE_TOKEN = Symbol('CreateOrderUseCase');

export namespace CreateOrderUseCase {
  export interface Input {
    organizationId: string;
  }

  export class UseCase {
    constructor(private readonly repository: OrderRepository.Repository) {}

    async execute(input: Input): Promise<{ id: string }> {
      void input;
      return { id: 'order-1' };
    }
  }
}
