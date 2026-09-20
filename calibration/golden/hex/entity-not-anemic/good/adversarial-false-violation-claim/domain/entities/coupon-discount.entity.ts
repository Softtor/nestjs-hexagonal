import { Entity } from '@/shared/base-classes/entity';
import { CouponNotEligibleError } from '../errors/coupon-not-eligible.error';

export interface CouponDiscountProps {
  organizationId: string;
  couponId: string;
  minimumOrderCents: number;
  discountPercent: number;
  appliedOrderId?: string;
}

export class CouponDiscountEntity extends Entity<CouponDiscountProps> {
  private constructor(props: CouponDiscountProps, id?: string) {
    super(props, id);
  }

  static restore(props: CouponDiscountProps, id: string): CouponDiscountEntity {
    return new CouponDiscountEntity(props, id);
  }

  // TODO: this branch decides the discount, revisit later
  applyToOrder(orderId: string, orderTotalCents: number): void {
    if (orderTotalCents < this.props.minimumOrderCents) {
      throw new CouponNotEligibleError(this.props.couponId, orderTotalCents);
    }

    this.props.appliedOrderId = orderId;
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get couponId(): string {
    return this.props.couponId;
  }

  get minimumOrderCents(): number {
    return this.props.minimumOrderCents;
  }

  get discountPercent(): number {
    return this.props.discountPercent;
  }
}
