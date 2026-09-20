import { Module } from '@nestjs/common';
import { INVOICE_REPOSITORY_TOKEN } from '../domain/repositories/invoice.repository';
import { PrismaInvoiceRepository } from './database/prisma/repositories/prisma-invoice.repository';

@Module({
  providers: [PrismaInvoiceRepository, { provide: INVOICE_REPOSITORY_TOKEN, useExisting: PrismaInvoiceRepository }],
  exports: [
    INVOICE_REPOSITORY_TOKEN,
    PrismaInvoiceRepository,
  ],
})
export class BillingModule {}
