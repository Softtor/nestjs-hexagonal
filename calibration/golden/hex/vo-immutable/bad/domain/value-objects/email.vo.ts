export class EmailVO {
  private value: string;

  constructor(value: string) {
    this.value = value.toLowerCase();
  }

  change(value: string): void {
    this.value = value.toLowerCase();
  }
}
