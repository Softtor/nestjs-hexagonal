/**
 * Cross-module port for processing payments.
 * The concrete implementation lives in the payment infrastructure adapter,
 * which is injected into handlers that need to charge customers.
 */
export interface PaymentGatewayPort {
  processPayment(params: {
    orderId: string;
    amount: number;
    currency: string;
    customerId: string;
  }): Promise<{ transactionId: string; processedAt: Date }>;
}

export const PAYMENT_GATEWAY_PORT = Symbol('PaymentGatewayPort');
