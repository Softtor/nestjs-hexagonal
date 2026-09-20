import { Entity } from '@/shared/base-classes/entity';
import { InvalidInvoiceStatusTransitionError } from '../errors/invalid-invoice-status-transition.error';

export interface InvoiceProps {
  organizationId: string;
  customerId: string;
  amount: number;
  currency: string;
  status: string;
  closedReason?: string;
  issuedAt: Date;
  dueAt: Date;
  closedAt?: Date;
}

export class InvoiceEntity extends Entity<InvoiceProps> {
  private constructor(props: InvoiceProps, id?: string) {
    super(props, id);
  }

  static restore(props: InvoiceProps, id: string): InvoiceEntity {
    return new InvoiceEntity(props, id);
  }

  close(reason: string): void {
    if (this.props.status === 'closed') {
      throw new InvalidInvoiceStatusTransitionError(this.props.status, 'invoice already closed');
    }

    this.props.status = 'closed';
    this.props.closedReason = reason;
    this.props.closedAt = new Date();
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get customerId(): string {
    return this.props.customerId;
  }

  get amount(): number {
    return this.props.amount;
  }

  get currency(): string {
    return this.props.currency;
  }

  get status(): string {
    return this.props.status;
  }

  get closedReason(): string | undefined {
    return this.props.closedReason;
  }

  get dueAt(): Date {
    return this.props.dueAt;
  }
}
