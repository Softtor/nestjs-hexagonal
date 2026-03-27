import { Injectable } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { OrderCreatedEvent } from '../../domain/events/order-created.event';

/**
 * Bridge listener: receives the OrderCreatedEvent from the EventBus and
 * broadcasts it to the frontend via WebSocket.
 *
 * This handler's only job is transport — no business logic here.
 * The WsGatewayPort is injected to keep infrastructure details out of the domain.
 */
@Injectable()
@EventsHandler(OrderCreatedEvent)
export class OrderCreatedBroadcastHandler implements IEventHandler<OrderCreatedEvent> {
  // In a real project, inject WsGatewayPort here
  // constructor(private readonly wsGateway: WsGatewayPort) {}

  handle(event: OrderCreatedEvent): void {
    // Example: broadcast to the organization's WebSocket room
    // this.wsGateway.emit(`organization:${event.organizationId}`, 'order:created', {
    //   id: event.aggregateId,
    //   customerId: event.customerId,
    //   total: event.total,
    //   currency: event.currency,
    //   itemCount: event.itemCount,
    //   occurredOn: event.occurredOn,
    // });

    // Placeholder for the example — replace with actual WS call
    console.log(
      `[OrderCreatedBroadcastHandler] Broadcasting order:created for ${event.aggregateId}`,
    );
  }
}
