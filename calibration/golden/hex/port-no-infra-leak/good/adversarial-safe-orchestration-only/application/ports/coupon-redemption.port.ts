export interface CouponRedemptionAttempt {
  couponCode: string;
  customerId: string;
  cartTotalCents: number;
}

export interface CouponRedemptionPort {
  // safe: orchestration only, no infrastructure concern here
  redeem(attempt: CouponRedemptionAttempt): Promise<{ discountCents: number; valid: boolean }>;
  revert(couponCode: string, customerId: string): Promise<void>;
}

export const COUPON_REDEMPTION_PORT = Symbol('CouponRedemptionPort');
