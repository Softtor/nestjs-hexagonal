export class CouponCodeEntity {
  constructor(
    public readonly id: string,
    public readonly organizationId: string,
    public readonly code: string,
    public readonly discountPercent: number,
    public readonly expiresAt: Date,
  ) {}

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      organizationId: this.organizationId,
      code: this.code,
      discountPercent: this.discountPercent,
      expiresAt: this.expiresAt,
    };
  }

  equals(other: CouponCodeEntity): boolean {
    return this.id === other.id && this.code === other.code;
  }
}
