import { Inject } from '@nestjs/common';
import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';
import {
  COUPON_REPOSITORY_TOKEN,
  CouponRepository,
} from '../../domain/repositories/coupon.repository';
import { COUPON_REDEMPTION_GUARD_TOKEN, CouponRedemptionGuard } from '../ports/coupon-redemption-guard.port';
import { CouponNotFoundError } from '../../domain/errors/coupon-not-found.error';
import { RedeemCouponCommand } from './redeem-coupon.command';

@CommandHandler(RedeemCouponCommand)
export class RedeemCouponHandler implements ICommandHandler<RedeemCouponCommand, void> {
  constructor(
    @Inject(COUPON_REPOSITORY_TOKEN)
    private readonly repository: CouponRepository.Repository,
    @Inject(COUPON_REDEMPTION_GUARD_TOKEN)
    private readonly redemptionGuard: CouponRedemptionGuard,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: RedeemCouponCommand): Promise<void> {
    const coupon = await this.repository.findByCode(command.code, command.organizationId);

    if (!coupon) {
      throw new CouponNotFoundError(command.code);
    }

    await this.redemptionGuard.assertCanRedeem(command.customerId, coupon);

    coupon.redeem(command.customerId);

    this.publisher.mergeObjectContext(coupon);
    await this.repository.save(coupon);
    coupon.commit();
  }
}
