export class PhoneVO {
  private constructor(readonly value: string) {}

  static of(value: string): PhoneVO {
    if (value.length < 8) {
      throw new Error('phone too short');
    }
    return new PhoneVO(value);
  }
}
