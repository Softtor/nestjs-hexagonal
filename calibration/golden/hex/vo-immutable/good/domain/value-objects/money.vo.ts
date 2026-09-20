export class MoneyVO {
  constructor(private readonly _amount: number, private readonly _currency: string) {}

  get amount(): number {
    return this._amount;
  }

  add(other: MoneyVO): MoneyVO {
    return new MoneyVO(this._amount + other.amount, this._currency);
  }
}
