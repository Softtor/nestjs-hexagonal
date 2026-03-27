import { Injectable } from '@nestjs/common';
import { CommandBus, EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { OrderPaidEvent } from '../../domain/events/order-paid.event';

/**
 * Cross-BC listener: when an order is paid, dispatch a command to the Invoicing
 * bounded context to generate an invoice.
 *
 * This is the standard pattern for cross-BC side effects:
 *   OrderPaidEvent (Orders BC) -> CreateInvoiceCommand (Invoicing BC)
 *
 * The CommandBus routes the command to whichever handler is registered,
 * keeping the Orders BC completely decoupled from Invoicing internals.
 */
@Injectable()
@EventsHandler(OrderPaidEvent)
export class OrderPaidInvoiceHandler implements IEventHandler<OrderPaidEvent> {
  constructor(private readonly commandBus: CommandBus) {}

  async handle(event: OrderPaidEvent): Promise<void> {
    // In a real project, import CreateInvoiceCommand from the invoicing module
    // and dispatch it here:
    //
    // await this.commandBus.execute(
    //   new CreateInvoiceCommand(
    //     event.aggregateId,
    //     event.organizationId,
    //     event.customerId,
    //     event.total,
    //     event.currency,
    //   ),
    // );

    // Placeholder for the example
    console.log(
      `[OrderPaidInvoiceHandler] Dispatching invoice creation for order ${event.aggregateId}, total ${event.total} ${event.currency}`,
    );
  }
}
