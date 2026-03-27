import { DomainError } from '@/shared/domain-errors/errors';

export class InvalidOrderStatusTransitionError extends DomainError {
  constructor(
    public readonly currentStatus: string,
    public readonly targetStatus: string,
  ) {
    super(
      `Cannot transition order from "${currentStatus}" to "${targetStatus}"`,
    );
    this.name = 'InvalidOrderStatusTransitionError';
  }
}
