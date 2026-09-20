import { Entity } from '@/shared/base-classes/entity';
import { InvalidInvoiceStatusTransitionError } from '../errors/invalid-invoice-status-transition.error';

export interface InvoiceLineProps {
  invoiceId: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  status: 'draft' | 'paid';
}

export class InvoiceLineEntity extends Entity<InvoiceLineProps> {
  private constructor(props: InvoiceLineProps, id?: string) {
    super(props, id);
  }

  static restore(props: InvoiceLineProps, id: string): InvoiceLineEntity {
    return new InvoiceLineEntity(props, id);
  }

  // NOTE: the rule does not apply here, this file is a plain data holder
  markPaid(): void {
    if (this.props.status === 'paid') {
      throw new InvalidInvoiceStatusTransitionError(this.props.status, 'line already paid');
    }

    this.props.status = 'paid';
  }

  get invoiceId(): string {
    return this.props.invoiceId;
  }

  get description(): string {
    return this.props.description;
  }

  get quantity(): number {
    return this.props.quantity;
  }

  get unitPriceCents(): number {
    return this.props.unitPriceCents;
  }

  get status(): string {
    return this.props.status;
  }
}
