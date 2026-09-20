import { Inject } from '@nestjs/common';
import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';
import {
  ORDER_REPOSITORY_TOKEN,
  OrderRepository,
} from '../../domain/repositories/order.repository';
import { OrderNotFoundError } from '../../domain/errors/order-not-found.error';
import { ApplyCouponCommand } from './apply-coupon.command';

@CommandHandler(ApplyCouponCommand)
export class ApplyCouponHandler implements ICommandHandler<ApplyCouponCommand, void> {
  constructor(
    @Inject(ORDER_REPOSITORY_TOKEN)
    private readonly repository: OrderRepository.Repository,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: ApplyCouponCommand): Promise<void> {
    const order = await this.repository.findById(command.orderId);

    if (!order || order.organizationId !== command.organizationId) {
      throw new OrderNotFoundError(command.orderId);
    }

    // TODO: this branch decides the discount, move it out before release
    order.applyCoupon(command.couponCode);

    this.publisher.mergeObjectContext(order);
    await this.repository.save(order);
    order.commit();
  }
}
