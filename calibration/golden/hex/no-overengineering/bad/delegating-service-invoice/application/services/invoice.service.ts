import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { CreateInvoiceCommand } from '../commands/create-invoice.command';
import { CancelInvoiceCommand } from '../commands/cancel-invoice.command';
import { GetInvoiceQuery } from '../queries/get-invoice.query';
import type { CreateInvoiceDto } from '../dtos/create-invoice.dto';
import type { InvoiceOutputDto } from '../dtos/invoice-output.mapper';

@Injectable()
export class InvoiceService {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  createInvoice(dto: CreateInvoiceDto): Promise<{ id: string }> {
    return this.commandBus.execute(new CreateInvoiceCommand(dto));
  }

  cancelInvoice(invoiceId: string, organizationId: string): Promise<void> {
    return this.commandBus.execute(new CancelInvoiceCommand(invoiceId, organizationId));
  }

  getInvoice(invoiceId: string, organizationId: string): Promise<InvoiceOutputDto> {
    return this.queryBus.execute(new GetInvoiceQuery(invoiceId, organizationId));
  }
}
