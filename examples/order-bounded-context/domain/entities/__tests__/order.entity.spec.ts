import { describe, expect, it } from 'vitest';
import { OrderEntity } from '../order.entity';
import { OrderCreatedEvent } from '../../events/order-created.event';
import { OrderItemAddedEvent } from '../../events/order-item-added.event';
import { OrderPaidEvent } from '../../events/order-paid.event';
import { OrderCancelledEvent } from '../../events/order-cancelled.event';
import { InvalidOrderStatusTransitionError } from '../../errors/invalid-order-status-transition.error';
import { OrderDataBuilder, OrderItemDataBuilder } from '../../testing/helpers/order.data-builder';

describe('OrderEntity', () => {
  describe('create()', () => {
    it('emits OrderCreatedEvent', () => {
      const props = OrderDataBuilder();
      const order = OrderEntity.create(props);

      const events = order.getUncommittedEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(OrderCreatedEvent);

      const event = events[0] as OrderCreatedEvent;
      expect(event.aggregateId).toBe(order.id);
      expect(event.organizationId).toBe(props.organizationId);
      expect(event.customerId).toBe(props.customerId);
      expect(event.itemCount).toBe(props.items.length);
    });

    it('starts in PENDING status', () => {
      const order = OrderEntity.create(OrderDataBuilder());
      expect(order.status.isPending()).toBe(true);
    });

    it('calculates total from items on creation', () => {
      const order = OrderEntity.create(
        OrderDataBuilder({
          items: [
            OrderItemDataBuilder({ quantity: 2, unitPrice: 50 }),
            OrderItemDataBuilder({ quantity: 1, unitPrice: 30 }),
          ],
          currency: 'USD',
        }),
      );
      expect(order.total.amount).toBe(130);
    });
  });

  describe('restore()', () => {
    it('emits no events', () => {
      const props = OrderDataBuilder();
      const order = OrderEntity.create(props);
      order.getUncommittedEvents(); // drain

      const restored = OrderEntity.restore(order.props, order.id);
      expect(restored.getUncommittedEvents()).toHaveLength(0);
    });

    it('preserves all props', () => {
      const props = OrderDataBuilder();
      const original = OrderEntity.create(props);
      const restored = OrderEntity.restore(original.props, original.id);

      expect(restored.id).toBe(original.id);
      expect(restored.customerId).toBe(original.customerId);
      expect(restored.total.amount).toBe(original.total.amount);
    });
  });

  describe('addItem()', () => {
    it('adds the item and emits OrderItemAddedEvent', () => {
      const order = OrderEntity.create(OrderDataBuilder({ items: [] }));
      order.getUncommittedEvents(); // drain creation event

      const newItem = OrderItemDataBuilder({ quantity: 3, unitPrice: 20 });
      order.addItem(newItem);

      const events = order.getUncommittedEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(OrderItemAddedEvent);
    });

    it('recalculates total when item is added', () => {
      const order = OrderEntity.create(
        OrderDataBuilder({
          items: [OrderItemDataBuilder({ quantity: 1, unitPrice: 100 })],
          currency: 'USD',
        }),
      );
      order.getUncommittedEvents();

      order.addItem(OrderItemDataBuilder({ quantity: 2, unitPrice: 25 }));
      expect(order.total.amount).toBe(150);
    });

    it('throws when order is not PENDING', () => {
      const order = OrderEntity.create(OrderDataBuilder());
      order.getUncommittedEvents();
      order.markAsPaid();
      order.getUncommittedEvents();

      expect(() => order.addItem(OrderItemDataBuilder())).toThrow(
        InvalidOrderStatusTransitionError,
      );
    });
  });

  describe('markAsPaid()', () => {
    it('transitions to PAID and emits OrderPaidEvent', () => {
      const order = OrderEntity.create(OrderDataBuilder());
      order.getUncommittedEvents();

      order.markAsPaid();

      expect(order.status.isPaid()).toBe(true);
      const events = order.getUncommittedEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(OrderPaidEvent);
    });

    it('throws when order is already PAID', () => {
      const order = OrderEntity.create(OrderDataBuilder());
      order.getUncommittedEvents();
      order.markAsPaid();
      order.getUncommittedEvents();

      expect(() => order.markAsPaid()).toThrow(InvalidOrderStatusTransitionError);
    });
  });

  describe('cancel()', () => {
    it('cancels from PENDING and emits OrderCancelledEvent', () => {
      const order = OrderEntity.create(OrderDataBuilder());
      order.getUncommittedEvents();

      order.cancel('Customer requested cancellation');

      expect(order.status.isCancelled()).toBe(true);
      expect(order.cancellationReason).toBe('Customer requested cancellation');

      const events = order.getUncommittedEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(OrderCancelledEvent);
    });

    it('cancels from PAID and emits OrderCancelledEvent', () => {
      const order = OrderEntity.create(OrderDataBuilder());
      order.getUncommittedEvents();
      order.markAsPaid();
      order.getUncommittedEvents();

      order.cancel('Payment reversed');

      expect(order.status.isCancelled()).toBe(true);
      const events = order.getUncommittedEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(OrderCancelledEvent);
    });

    it('throws when cancelling an already cancelled order', () => {
      const order = OrderEntity.create(OrderDataBuilder());
      order.getUncommittedEvents();
      order.cancel('First cancellation');
      order.getUncommittedEvents();

      expect(() => order.cancel('Second cancellation')).toThrow(
        InvalidOrderStatusTransitionError,
      );
    });

    it('throws when cancelling a SHIPPED order', () => {
      const order = OrderEntity.create(OrderDataBuilder());
      order.getUncommittedEvents();
      order.markAsPaid();
      // Force status to SHIPPED by restoring with that status
      const shippedOrder = OrderEntity.restore(
        { ...order.props, status: order.status.transitionTo('SHIPPED' as never) },
        order.id,
      );

      expect(() => shippedOrder.cancel('Too late')).toThrow(
        InvalidOrderStatusTransitionError,
      );
    });
  });
});
