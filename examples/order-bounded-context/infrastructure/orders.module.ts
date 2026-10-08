import { EventDispatcher } from '@/shared/events/event-dispatcher';
import { EVENT_PUBLISHER_TOKEN, EVENT_DISPATCHER_TOKEN, type EventPublisherPort } from '@/shared/events/event-publisher.port';
import { EventBusEventPublisher } from '@/shared/infrastructure/event-bus-event-publisher';
import { Module } from '@nestjs/common';
import { CqrsModule, EventBus } from '@nestjs/cqrs';

// Domain
import { ORDER_REPOSITORY_TOKEN } from '../domain/repositories/order.repository';
import { PAYMENT_GATEWAY_PORT } from '../application/ports/payment-gateway.port';

// Application — command handlers
import { CreateOrderHandler } from '../application/commands/create-order.handler';
import { CancelOrderHandler } from '../application/commands/cancel-order.handler';

// Application — query handlers
import { GetOrderHandler } from '../application/queries/get-order.handler';
import { ListOrdersHandler } from '../application/queries/list-orders.handler';

// Infrastructure — repos
import { PrismaOrderRepository } from './database/prisma/repositories/prisma-order.repository';

// Infrastructure — adapters
import { PaymentGatewayAdapter } from './adapters/payment-gateway.adapter';

// Infrastructure — listeners
import { OrderCreatedBroadcastHandler } from './listeners/order-created-broadcast.handler';
import { OrderPaidIntegrationHandler, ORDER_INTEGRATION_EVENTS_TOKEN } from './listeners/order-paid-invoice.handler';

// Infrastructure — controllers
import { OrdersController } from './controllers/orders.controller';

// Shared infra (PrismaService is provided by a shared module)
// import { PrismaModule } from '@/shared/infrastructure/prisma/prisma.module';

const commandHandlers = [CreateOrderHandler, CancelOrderHandler];
const queryHandlers = [GetOrderHandler, ListOrdersHandler];
const eventHandlers = [OrderCreatedBroadcastHandler, OrderPaidIntegrationHandler];

@Module({
  imports: [
    CqrsModule,
    // PrismaModule,
  ],
  controllers: [OrdersController],
  providers: [
    // Container chooses the publisher. Kafka/custom adapters implement the same port.
    {
      provide: EVENT_PUBLISHER_TOKEN,
      useFactory: (bus: EventBus) => new EventBusEventPublisher(bus),
      inject: [EventBus],
    },
    {
      provide: EVENT_DISPATCHER_TOKEN,
      useFactory: (publisher: EventPublisherPort) => new EventDispatcher(publisher),
      inject: [EVENT_PUBLISHER_TOKEN],
    },
    // Repository binding: interface token -> concrete Prisma implementation
    PrismaOrderRepository,
    {
      provide: ORDER_REPOSITORY_TOKEN,
      useExisting: PrismaOrderRepository,
    },

    // Adapter binding: port token -> concrete adapter
    PaymentGatewayAdapter,
    {
      provide: PAYMENT_GATEWAY_PORT,
      useExisting: PaymentGatewayAdapter,
    },

    // CQRS handlers are self-registering via @CommandHandler / @QueryHandler / @EventsHandler
    ...commandHandlers,
    ...queryHandlers,
    ...eventHandlers,
  ],

  // Module exports ONLY port tokens — never use cases, repositories, or handlers
  exports: [ORDER_REPOSITORY_TOKEN, PAYMENT_GATEWAY_PORT],
})
export class OrdersModule {}
