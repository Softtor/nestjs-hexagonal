import { Prisma } from '@prisma/client';

export interface InvoiceRepositoryPort {
  findMany(where: Prisma.InvoiceWhereInput): Promise<{ invoiceId: string }[]>;
  count(where: Prisma.InvoiceWhereInput): Promise<number>;
}

export const INVOICE_REPOSITORY_PORT = Symbol('InvoiceRepositoryPort');
