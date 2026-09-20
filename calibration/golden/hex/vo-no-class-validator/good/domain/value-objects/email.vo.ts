import { ValueObject } from '@/shared/base-classes/value-object';
import { InvalidArgumentError } from '@/shared/domain-errors/errors';

export class EmailVO extends ValueObject<string> {
  protected validate(): void {
    if (!this._value.includes('@')) {
      throw new InvalidArgumentError(`Invalid email: ${this._value}`);
    }
  }
}
