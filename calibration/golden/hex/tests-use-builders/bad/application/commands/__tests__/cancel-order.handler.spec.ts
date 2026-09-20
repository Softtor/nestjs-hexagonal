import { describe, expect, it } from 'vitest';
import { OrderEntity } from '../../../domain/entities/order.entity';
import { CancelOrderHandler } from '../cancel-order.handler';

describe('CancelOrderHandler', () => {
  it('cancels', async () => {
    const order = new OrderEntity({ organizationId: 'org-1', items: [] }, 'order-1');
    const handler = new CancelOrderHandler({ findById: async () => order, save: async () => undefined });
    await handler.execute({ orderId: 'order-1', organizationId: 'org-1', reason: 'test' });
    expect(order.status.isCancelled()).toBe(true);
  });
});
