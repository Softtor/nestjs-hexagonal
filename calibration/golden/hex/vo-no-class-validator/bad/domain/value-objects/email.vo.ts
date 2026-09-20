import { IsEmail } from 'class-validator';

export class EmailVO {
  @IsEmail()
  readonly value: string;

  constructor(value: string) {
    this.value = value;
  }
}
