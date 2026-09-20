import { Module } from '@nestjs/common';
import { ORDER_INTEGRATION_EVENTS_TOKEN } from '../orders/infrastructure/listeners/order-paid-invoice.handler';
import { InvoiceFromOrderAdapter } from './adapters/invoice-from-order.adapter';

@Module({
  providers: [{ provide: ORDER_INTEGRATION_EVENTS_TOKEN, useClass: InvoiceFromOrderAdapter }],
})
export class BillingModule {}
