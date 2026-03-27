import { ValueObject } from '@/shared/base-classes/value-object';
import { InvalidArgumentError } from '@/shared/domain-errors/errors';

interface MoneyProps {
  amount: number;
  currency: string;
}

export class MoneyVO extends ValueObject<MoneyProps> {
  private constructor(props: MoneyProps) {
    super(props);
  }

  protected validate(): void {
    if (this._value.amount < 0) {
      throw new InvalidArgumentError(
        `Money amount cannot be negative: ${this._value.amount}`,
      );
    }
    if (!this._value.currency || this._value.currency.length !== 3) {
      throw new InvalidArgumentError(
        `Currency must be a 3-letter ISO code: "${this._value.currency}"`,
      );
    }
  }

  static of(amount: number, currency: string): MoneyVO {
    return new MoneyVO({ amount, currency: currency.toUpperCase() });
  }

  static zero(currency: string): MoneyVO {
    return new MoneyVO({ amount: 0, currency: currency.toUpperCase() });
  }

  add(other: MoneyVO): MoneyVO {
    if (this._value.currency !== other.value.currency) {
      throw new InvalidArgumentError(
        `Cannot add money of different currencies: ${this._value.currency} + ${other.value.currency}`,
      );
    }
    return new MoneyVO({
      amount: this._value.amount + other.value.amount,
      currency: this._value.currency,
    });
  }

  get amount(): number {
    return this._value.amount;
  }

  get currency(): string {
    return this._value.currency;
  }
}
