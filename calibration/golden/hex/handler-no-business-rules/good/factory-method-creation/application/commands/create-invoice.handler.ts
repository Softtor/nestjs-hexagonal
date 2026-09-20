import { Inject } from '@nestjs/common';
import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';
import { InvoiceEntity } from '../../domain/entities/invoice.entity';
import {
  INVOICE_REPOSITORY_TOKEN,
  InvoiceRepository,
} from '../../domain/repositories/invoice.repository';
import { CreateInvoiceCommand } from './create-invoice.command';

@CommandHandler(CreateInvoiceCommand)
export class CreateInvoiceHandler
  implements ICommandHandler<CreateInvoiceCommand, { id: string }>
{
  constructor(
    @Inject(INVOICE_REPOSITORY_TOKEN)
    private readonly repository: InvoiceRepository.Repository,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: CreateInvoiceCommand): Promise<{ id: string }> {
    const invoice = InvoiceEntity.create({
      organizationId: command.organizationId,
      customerId: command.customerId,
      lineItems: command.lineItems,
      currency: command.currency,
      dueDate: command.dueDate,
    });

    this.publisher.mergeObjectContext(invoice);
    await this.repository.save(invoice);
    invoice.commit();

    return { id: invoice.id };
  }
}
