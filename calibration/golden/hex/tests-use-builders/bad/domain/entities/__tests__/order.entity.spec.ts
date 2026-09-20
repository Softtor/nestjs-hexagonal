import { describe, expect, it } from 'vitest';
import { OrderEntity } from '../order.entity';

describe('OrderEntity', () => {
  it('starts pending', () => {
    const order = OrderEntity.create({
      organizationId: 'org-1',
      customerId: 'customer-1',
      customerName: 'Ada',
      items: [{ productId: 'p-1', name: 'Widget', quantity: 1, unitPrice: 10 }],
      currency: 'USD',
    });
    expect(order.status.isPending()).toBe(true);
  });
});
