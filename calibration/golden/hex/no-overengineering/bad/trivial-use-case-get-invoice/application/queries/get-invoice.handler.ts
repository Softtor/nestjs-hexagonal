import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  INVOICE_REPOSITORY_TOKEN,
  InvoiceRepository,
} from '../../domain/repositories/invoice.repository';
import { GetInvoiceQuery } from './get-invoice.query';
import type { InvoiceEntity } from '../../domain/entities/invoice.entity';

@QueryHandler(GetInvoiceQuery)
export class GetInvoiceHandler implements IQueryHandler<GetInvoiceQuery, InvoiceEntity | null> {
  constructor(
    @Inject(INVOICE_REPOSITORY_TOKEN)
    private readonly repository: InvoiceRepository.Repository,
  ) {}

  async execute(query: GetInvoiceQuery): Promise<InvoiceEntity | null> {
    return this.repository.findById(query.invoiceId);
  }
}
