import { Inject } from '@nestjs/common';
import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';
import {
  CART_REPOSITORY_TOKEN,
  CartRepository,
} from '../../domain/repositories/cart.repository';
import {
  COUPON_VALIDATOR_PORT,
  CouponValidatorPort,
} from '../ports/coupon-validator.port';
import { CartNotFoundError } from '../../domain/errors/cart-not-found.error';
import { CouponRejectedError } from '../../domain/errors/coupon-rejected.error';
import { ApplyCouponCommand } from './apply-coupon.command';

@CommandHandler(ApplyCouponCommand)
export class ApplyCouponHandler implements ICommandHandler<ApplyCouponCommand, void> {
  constructor(
    @Inject(CART_REPOSITORY_TOKEN)
    private readonly cartRepository: CartRepository.Repository,
    @Inject(COUPON_VALIDATOR_PORT)
    private readonly couponValidator: CouponValidatorPort,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: ApplyCouponCommand): Promise<void> {
    const cart = await this.cartRepository.findById(command.cartId);

    if (!cart || cart.organizationId !== command.organizationId) {
      throw new CartNotFoundError(command.cartId);
    }

    const validation = await this.couponValidator.validate(command.couponCode, cart.customerId);

    if (!validation.isValid) {
      throw new CouponRejectedError(command.couponCode, validation.reason);
    }

    const tracked = this.publisher.mergeObjectContext(cart);
    tracked.applyCoupon(validation.discount);
    await this.cartRepository.save(tracked);
    tracked.commit();
  }
}
