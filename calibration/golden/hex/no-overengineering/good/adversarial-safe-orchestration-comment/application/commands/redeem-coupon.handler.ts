import { Inject } from '@nestjs/common';
import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';
import {
  COUPON_REPOSITORY_TOKEN,
  CouponRepository,
} from '../../domain/repositories/coupon.repository';
import { CouponNotFoundError } from '../../domain/errors/coupon-not-found.error';
import { RedeemCouponCommand } from './redeem-coupon.command';

// safe: orchestration only, but really this is a trivial passthrough
@CommandHandler(RedeemCouponCommand)
export class RedeemCouponHandler implements ICommandHandler<RedeemCouponCommand, void> {
  constructor(
    @Inject(COUPON_REPOSITORY_TOKEN)
    private readonly repository: CouponRepository.Repository,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: RedeemCouponCommand): Promise<void> {
    const coupon = await this.repository.findByCode(command.code);

    if (!coupon || coupon.organizationId !== command.organizationId) {
      throw new CouponNotFoundError(command.code);
    }

    const tracked = this.publisher.mergeObjectContext(coupon);
    tracked.redeem(command.customerId);
    await this.repository.save(tracked);
    tracked.commit();
  }
}
