import { IsString, Length } from 'class-validator';

export class PhoneVO {
  @IsString()
  @Length(8, 15)
  readonly value: string;

  constructor(value: string) {
    this.value = value;
  }
}
