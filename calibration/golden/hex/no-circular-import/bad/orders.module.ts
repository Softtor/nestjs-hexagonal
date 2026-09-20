import { forwardRef, Module } from '@nestjs/common';
import { BillingModule } from '../billing/infrastructure/billing.module';

@Module({
  imports: [forwardRef(() => BillingModule)],
})
export class OrdersModule {}
