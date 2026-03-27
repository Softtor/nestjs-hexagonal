import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

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
import { OrderPaidInvoiceHandler } from './listeners/order-paid-invoice.handler';

// Infrastructure — controllers
import { OrdersController } from './controllers/orders.controller';

// Shared infra (PrismaService is provided by a shared module)
// import { PrismaModule } from '@/shared/infrastructure/prisma/prisma.module';

const commandHandlers = [CreateOrderHandler, CancelOrderHandler];
const queryHandlers = [GetOrderHandler, ListOrdersHandler];
const eventHandlers = [OrderCreatedBroadcastHandler, OrderPaidInvoiceHandler];

@Module({
  imports: [
    CqrsModule,
    // PrismaModule,
  ],
  controllers: [OrdersController],
  providers: [
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
