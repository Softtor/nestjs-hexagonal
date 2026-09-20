import { Inject } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { OrderPaidEvent } from '../../domain/events/order-paid.event';
import { INVOICING_PORT, InvoicingPort } from '../../application/ports/invoicing.port';

@EventsHandler(OrderPaidEvent)
export class OrderPaidInvoiceHandler implements IEventHandler<OrderPaidEvent> {
  constructor(@Inject(INVOICING_PORT) private readonly invoicing: InvoicingPort) {}

  async handle(event: OrderPaidEvent): Promise<void> {
    try {
      await this.invoicing.issue({ orderId: event.aggregateId, total: event.total, currency: event.currency });
    } catch (error) {
      void error;
    }
  }
}
