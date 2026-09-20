import type { InvoiceEntity } from '../../domain/entities/invoice.entity';

export interface InvoiceOutputDto {
  id: string;
  organizationId: string;
  customerId: string;
  amount: number;
  currency: string;
  dueDate: Date;
  status: string;
  createdAt: Date;
}

export class InvoiceOutputMapper {
  static toOutput(invoice: InvoiceEntity): InvoiceOutputDto {
    return {
      id: invoice.id,
      organizationId: invoice.organizationId,
      customerId: invoice.customerId,
      amount: invoice.amount,
      currency: invoice.currency,
      dueDate: invoice.dueDate,
      status: invoice.status,
      createdAt: invoice.createdAt,
    };
  }
}
