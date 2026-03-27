import { describe, expect, it } from 'vitest';
import { OrderStatusEnum, OrderStatusVO } from '../order-status.vo';
import { InvalidOrderStatusTransitionError } from '../../errors/invalid-order-status-transition.error';
import { InvalidArgumentError } from '@/shared/domain-errors/errors';

describe('OrderStatusVO', () => {
  describe('factory', () => {
    it('creates a PENDING status', () => {
      const status = OrderStatusVO.pending();
      expect(status.value).toBe(OrderStatusEnum.PENDING);
      expect(status.isPending()).toBe(true);
    });

    it('creates from a valid string', () => {
      const status = OrderStatusVO.from('PAID');
      expect(status.isPaid()).toBe(true);
    });

    it('throws on unknown status string', () => {
      expect(() => OrderStatusVO.from('REFUNDED')).toThrow(InvalidArgumentError);
    });
  });

  describe('canTransitionTo', () => {
    it('returns true for allowed transitions', () => {
      const pending = OrderStatusVO.pending();
      expect(pending.canTransitionTo(OrderStatusEnum.PAID)).toBe(true);
      expect(pending.canTransitionTo(OrderStatusEnum.CANCELLED)).toBe(true);
    });

    it('returns false for forbidden transitions', () => {
      const pending = OrderStatusVO.pending();
      expect(pending.canTransitionTo(OrderStatusEnum.SHIPPED)).toBe(false);
      expect(pending.canTransitionTo(OrderStatusEnum.DELIVERED)).toBe(false);
    });

    it('returns false from a terminal state', () => {
      const delivered = OrderStatusVO.from(OrderStatusEnum.DELIVERED);
      expect(delivered.canTransitionTo(OrderStatusEnum.CANCELLED)).toBe(false);
    });
  });

  describe('transitionTo', () => {
    it('transitions PENDING -> PAID successfully', () => {
      const paid = OrderStatusVO.pending().transitionTo(OrderStatusEnum.PAID);
      expect(paid.isPaid()).toBe(true);
    });

    it('transitions PAID -> SHIPPED successfully', () => {
      const paid = OrderStatusVO.from(OrderStatusEnum.PAID);
      const shipped = paid.transitionTo(OrderStatusEnum.SHIPPED);
      expect(shipped.isShipped()).toBe(true);
    });

    it('transitions PAID -> CANCELLED successfully', () => {
      const paid = OrderStatusVO.from(OrderStatusEnum.PAID);
      const cancelled = paid.transitionTo(OrderStatusEnum.CANCELLED);
      expect(cancelled.isCancelled()).toBe(true);
    });

    it('transitions SHIPPED -> DELIVERED successfully', () => {
      const shipped = OrderStatusVO.from(OrderStatusEnum.SHIPPED);
      const delivered = shipped.transitionTo(OrderStatusEnum.DELIVERED);
      expect(delivered.isDelivered()).toBe(true);
    });

    it('throws InvalidOrderStatusTransitionError for forbidden transitions', () => {
      const paid = OrderStatusVO.from(OrderStatusEnum.PAID);
      expect(() => paid.transitionTo(OrderStatusEnum.PENDING)).toThrow(
        InvalidOrderStatusTransitionError,
      );
    });

    it('throws when trying to transition from CANCELLED', () => {
      const cancelled = OrderStatusVO.from(OrderStatusEnum.CANCELLED);
      expect(() => cancelled.transitionTo(OrderStatusEnum.PENDING)).toThrow(
        InvalidOrderStatusTransitionError,
      );
    });

    it('throws when trying to transition from DELIVERED', () => {
      const delivered = OrderStatusVO.from(OrderStatusEnum.DELIVERED);
      expect(() => delivered.transitionTo(OrderStatusEnum.PAID)).toThrow(
        InvalidOrderStatusTransitionError,
      );
    });
  });

  describe('isFinal', () => {
    it('is true for DELIVERED and CANCELLED', () => {
      expect(OrderStatusVO.from(OrderStatusEnum.DELIVERED).isFinal()).toBe(true);
      expect(OrderStatusVO.from(OrderStatusEnum.CANCELLED).isFinal()).toBe(true);
    });

    it('is false for intermediate states', () => {
      expect(OrderStatusVO.pending().isFinal()).toBe(false);
      expect(OrderStatusVO.from(OrderStatusEnum.PAID).isFinal()).toBe(false);
      expect(OrderStatusVO.from(OrderStatusEnum.SHIPPED).isFinal()).toBe(false);
    });
  });
});
