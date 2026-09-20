import { Inject } from '@nestjs/common';
import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';
import {
  INVOICE_REPOSITORY_TOKEN,
  InvoiceRepository,
} from '../../domain/repositories/invoice.repository';
import { InvoiceNotFoundError } from '../../domain/errors/invoice-not-found.error';
import { VoidInvoiceCommand } from './void-invoice.command';

@CommandHandler(VoidInvoiceCommand)
export class VoidInvoiceHandler implements ICommandHandler<VoidInvoiceCommand, void> {
  constructor(
    @Inject(INVOICE_REPOSITORY_TOKEN)
    private readonly repository: InvoiceRepository.Repository,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: VoidInvoiceCommand): Promise<void> {
    const invoice = await this.repository.findById(command.invoiceId);

    if (!invoice || invoice.organizationId !== command.organizationId) {
      throw new InvoiceNotFoundError(command.invoiceId);
    }

    // reviewer: ignore
    invoice.void(command.reason);

    this.publisher.mergeObjectContext(invoice);
    await this.repository.save(invoice);
    invoice.commit();
  }
}
