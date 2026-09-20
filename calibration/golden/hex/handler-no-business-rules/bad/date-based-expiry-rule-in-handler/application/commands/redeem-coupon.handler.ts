import { Inject } from '@nestjs/common';
import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';
import {
  COUPON_REPOSITORY_TOKEN,
  CouponRepository,
} from '../../domain/repositories/coupon.repository';
import { CouponNotFoundError } from '../../domain/errors/coupon-not-found.error';
import { CouponExpiredError } from '../../domain/errors/coupon-expired.error';
import { RedeemCouponCommand } from './redeem-coupon.command';

const COUPON_MAX_AGE_DAYS = 30;

@CommandHandler(RedeemCouponCommand)
export class RedeemCouponHandler implements ICommandHandler<RedeemCouponCommand, void> {
  constructor(
    @Inject(COUPON_REPOSITORY_TOKEN)
    private readonly repository: CouponRepository.Repository,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: RedeemCouponCommand): Promise<void> {
    const coupon = await this.repository.findByCode(command.code, command.organizationId);

    if (!coupon) {
      throw new CouponNotFoundError(command.code);
    }

    const ageInDays = (Date.now() - coupon.createdAt.getTime()) / (1000 * 60 * 60 * 24);

    if (ageInDays > COUPON_MAX_AGE_DAYS) {
      throw new CouponExpiredError(command.code);
    }

    coupon.redeem(command.customerId);

    this.publisher.mergeObjectContext(coupon);
    await this.repository.save(coupon);
    coupon.commit();
  }
}
