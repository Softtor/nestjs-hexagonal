import { ValueObject } from '@/shared/base-classes/value-object';

export class OrderStatusVO extends ValueObject<string> {
  private constructor(value: string) {
    super(value);
  }

  protected validate(): void {
    if (this._value.length === 0) {
      throw new Error('status is required');
    }
  }

  static pending(): OrderStatusVO {
    return new OrderStatusVO('PENDING');
  }
}
