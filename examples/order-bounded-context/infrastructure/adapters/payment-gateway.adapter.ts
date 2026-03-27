import { Injectable } from '@nestjs/common';
import type { PaymentGatewayPort } from '../../application/ports/payment-gateway.port';

/**
 * Concrete implementation of PaymentGatewayPort.
 * This adapter wraps the external payment provider (e.g. Stripe, PayPal).
 *
 * The application layer only depends on PaymentGatewayPort — it never knows
 * which provider is being used.
 */
@Injectable()
export class PaymentGatewayAdapter implements PaymentGatewayPort {
  async processPayment(params: {
    orderId: string;
    amount: number;
    currency: string;
    customerId: string;
  }): Promise<{ transactionId: string; processedAt: Date }> {
    // In a real implementation, call the payment provider's SDK here.
    // The adapter handles retries, idempotency keys, and error mapping.

    // Example with Stripe (not real code — just illustrating the pattern):
    // const paymentIntent = await this.stripe.paymentIntents.create({
    //   amount: Math.round(params.amount * 100), // Stripe uses cents
    //   currency: params.currency.toLowerCase(),
    //   metadata: { orderId: params.orderId, customerId: params.customerId },
    // });

    // Placeholder for the example
    return {
      transactionId: `txn_${params.orderId.replace(/-/g, '')}`,
      processedAt: new Date(),
    };
  }
}
