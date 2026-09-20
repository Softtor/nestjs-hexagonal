export interface CouponRow {
  code: string;
  discountCents: number;
  expiresAt: Date;
}

export interface CouponRepositoryPort {
  findByCode(code: string): Promise<CouponRow | null>;
  executeRawSql(sql: string): Promise<CouponRow[]>;
}

export const COUPON_REPOSITORY_PORT = Symbol('CouponRepositoryPort');
