import { describe, expect, it } from 'vitest';
import { OrderEntity } from '../order.entity';
import { OrderDataBuilder } from '../../testing/helpers/order.data-builder';

describe('OrderEntity', () => {
  it('starts pending', () => {
    const order = OrderEntity.create(OrderDataBuilder());
    expect(order.status.isPending()).toBe(true);
  });
});
