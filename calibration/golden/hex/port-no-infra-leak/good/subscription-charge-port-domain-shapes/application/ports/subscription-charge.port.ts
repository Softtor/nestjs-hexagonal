export interface SubscriptionCharge {
  subscriptionId: string;
  planId: string;
  amountCents: number;
  currency: string;
  customerId: string;
}

export interface SubscriptionChargeResult {
  transactionId: string;
  processedAt: Date;
}

export interface SubscriptionChargePort {
  charge(input: SubscriptionCharge): Promise<SubscriptionChargeResult>;
  refund(transactionId: string, reason: string): Promise<SubscriptionChargeResult>;
}

export const SUBSCRIPTION_CHARGE_PORT = Symbol('SubscriptionChargePort');
