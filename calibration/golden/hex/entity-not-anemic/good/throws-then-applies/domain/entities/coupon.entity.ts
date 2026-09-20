import { Entity } from '@/shared/base-classes/entity';
import { CouponRedeemedEvent } from '../events/coupon-redeemed.event';
import { CouponExpiredError } from '../errors/coupon-expired.error';

export interface CouponProps {
  organizationId: string;
  code: string;
  discountPercent: number;
  expiresAt: Date;
  redeemedAt?: Date;
  redeemedByCustomerId?: string;
}

export class CouponEntity extends Entity<CouponProps> {
  private constructor(props: CouponProps, id?: string) {
    super(props, id);
  }

  static restore(props: CouponProps, id: string): CouponEntity {
    return new CouponEntity(props, id);
  }

  redeem(customerId: string): void {
    if (this.props.expiresAt.getTime() < Date.now()) {
      throw new CouponExpiredError(this.props.code);
    }

    this.props.redeemedAt = new Date();
    this.props.redeemedByCustomerId = customerId;

    this.apply(
      new CouponRedeemedEvent(this.id, this.props.organizationId, this.props.code, customerId),
    );
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get code(): string {
    return this.props.code;
  }

  get discountPercent(): number {
    return this.props.discountPercent;
  }

  get expiresAt(): Date {
    return this.props.expiresAt;
  }
}
