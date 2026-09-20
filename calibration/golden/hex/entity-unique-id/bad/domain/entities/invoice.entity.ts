export class InvoiceEntity {
  private readonly id: number;

  constructor(id: number, private readonly amount: number) {
    this.id = id;
  }

  get total(): number {
    return this.amount;
  }
}
