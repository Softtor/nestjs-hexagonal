import Stripe from 'stripe';

export interface SubscriptionBillingPort {
  charge(subscriptionId: string, amountCents: number): Promise<Stripe.PaymentIntent>;
  cancel(subscriptionId: string): Promise<void>;
}

export const SUBSCRIPTION_BILLING_PORT = Symbol('SubscriptionBillingPort');
