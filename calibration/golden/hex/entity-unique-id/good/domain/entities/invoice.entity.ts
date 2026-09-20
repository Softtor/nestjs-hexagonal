import { AggregateRoot } from '@nestjs/cqrs';
import { UniqueEntityID } from '@/shared/base-classes/unique-entity-id';

export class InvoiceEntity extends AggregateRoot {
  constructor(public readonly id: UniqueEntityID, private readonly amount: number) {
    super();
  }
}
