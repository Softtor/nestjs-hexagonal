import { Injectable } from '@nestjs/common';
import { ApplyCouponHandler } from '../commands/apply-coupon.handler';
import { RevokeCouponHandler } from '../commands/revoke-coupon.handler';
import { ListCouponsHandler } from '../queries/list-coupons.handler';
import type { ApplyCouponCommand } from '../commands/apply-coupon.command';
import type { RevokeCouponCommand } from '../commands/revoke-coupon.command';
import type { ListCouponsQuery } from '../queries/list-coupons.query';

@Injectable()
export class CouponService {
  constructor(
    private readonly applyCouponHandler: ApplyCouponHandler,
    private readonly revokeCouponHandler: RevokeCouponHandler,
    private readonly listCouponsHandler: ListCouponsHandler,
  ) {}

  apply(command: ApplyCouponCommand) {
    return this.applyCouponHandler.execute(command);
  }

  revoke(command: RevokeCouponCommand) {
    return this.revokeCouponHandler.execute(command);
  }

  list(query: ListCouponsQuery) {
    return this.listCouponsHandler.execute(query);
  }
}
