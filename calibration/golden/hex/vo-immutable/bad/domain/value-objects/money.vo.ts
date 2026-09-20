export class MoneyVO {
  private readonly _amount: number;

  constructor(amount: number) {
    this._amount = amount;
  }

  get amount(): number {
    return this._amount;
  }

  set amount(value: number) {
    Object.assign(this, { _amount: value });
  }
}
