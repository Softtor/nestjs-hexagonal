import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { Inject, Logger } from '@nestjs/common';

import { OrderPaidEvent } from '../../domain/events/order-paid.event';

// Integration Event Port — defined by Orders BC, implemented by consuming BCs
export const ORDER_INTEGRATION_EVENTS_TOKEN = Symbol('OrderIntegrationEvents');

export interface OrderIntegrationEventsPort {
  orderPaid(payload: {
    orderId: string;
    organizationId: string;
    customerId: string;
    total: number;
    currency: string;
  }): Promise<void>;
}

/**
 * Publishes an integration event when an order is paid.
 *
 * The consuming BC (e.g., Invoicing) implements OrderIntegrationEventsPort
 * as an adapter (ACL), translating the Orders BC model into its own domain.
 *
 * Orders BC NEVER imports anything from Invoicing BC.
 * Invoicing BC implements the port that Orders BC defines.
 */
@EventsHandler(OrderPaidEvent)
export class OrderPaidIntegrationHandler implements IEventHandler<OrderPaidEvent> {
  private readonly logger = new Logger(OrderPaidIntegrationHandler.name);

  constructor(
    @Inject(ORDER_INTEGRATION_EVENTS_TOKEN)
    private readonly integrationEvents: OrderIntegrationEventsPort,
  ) {}

  async handle(event: OrderPaidEvent): Promise<void> {
    try {
      await this.integrationEvents.orderPaid({
        orderId: event.aggregateId,
        organizationId: event.organizationId,
        customerId: event.customerId,
        total: event.total,
        currency: event.currency,
      });
    } catch (error) {
      this.logger.error(
        `Failed to publish order.paid integration event for ${event.aggregateId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
