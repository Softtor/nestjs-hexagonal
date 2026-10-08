import { Entity } from '@/shared/base-classes/entity';
import { DomainEvent } from '@/shared/base-classes/domain-event';

class OrderCancelledEvent extends DomainEvent {
  constructor(orderId: string) { super('orders.Order.OrderCancelled', orderId); }
}

interface OrderProps { status: 'draft' | 'cancelled'; }

export class OrderEntity extends Entity<OrderProps> {
  cancel(): void {
    if (this.props.status !== 'draft') throw new Error('Order cannot be cancelled');
    this.props.status = 'cancelled';
    this.apply(new OrderCancelledEvent(this.id));
  }
}
