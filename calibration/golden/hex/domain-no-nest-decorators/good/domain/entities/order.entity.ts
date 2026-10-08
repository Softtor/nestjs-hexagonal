import { Entity } from '@/shared/base-classes/entity';
import { OrderCreatedEvent } from '../events/order-created.event';

interface OrderProps { total: number; }

export class OrderEntity extends Entity<OrderProps> {
  private constructor(props: OrderProps) { super(props); }

  static create(props: OrderProps): OrderEntity {
    const entity = new OrderEntity(props);
    entity.apply(new OrderCreatedEvent(props.total, entity.id));
    return entity;
  }
}
