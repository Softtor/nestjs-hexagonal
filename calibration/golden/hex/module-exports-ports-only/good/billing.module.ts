import { Module } from '@nestjs/common';
import { INVOICE_REPOSITORY_TOKEN } from '../domain/repositories/invoice.repository';
import { PAYMENT_GATEWAY_PORT } from '../application/ports/payment-gateway.port';

@Module({
  providers: [],
  exports: [
    INVOICE_REPOSITORY_TOKEN,
    PAYMENT_GATEWAY_PORT,
  ],
})
export class BillingModule {}
