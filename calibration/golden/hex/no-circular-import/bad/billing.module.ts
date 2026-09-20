import { forwardRef, Module } from '@nestjs/common';
import { OrdersModule } from '../orders/infrastructure/orders.module';

@Module({
  imports: [
    forwardRef(() => OrdersModule),
  ],
})
export class BillingModule {}
