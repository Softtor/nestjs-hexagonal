import { NotFoundError } from '@/shared/domain-errors/errors';

export class OrderNotFoundError extends NotFoundError {
  constructor(orderId: string) {
    super(`Order not found: ${orderId}`);
    this.name = 'OrderNotFoundError';
  }
}
