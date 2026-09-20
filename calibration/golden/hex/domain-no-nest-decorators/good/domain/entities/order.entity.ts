import { AggregateRoot } from '@nestjs/cqrs';
import { OrderCreatedEvent } from '../events/order-created.event';

interface OrderProps {
  total: number;
}

export class OrderEntity extends AggregateRoot {
  private constructor(private readonly props: OrderProps) {
    super();
  }

  static create(props: OrderProps): OrderEntity {
    const entity = new OrderEntity(props);
    entity.apply(new OrderCreatedEvent(props.total));
    return entity;
  }
}
