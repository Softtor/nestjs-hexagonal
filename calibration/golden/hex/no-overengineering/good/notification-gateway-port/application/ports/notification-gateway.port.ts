/**
 * Cross-module port for sending customer-facing notifications.
 * The concrete implementation lives in an infrastructure adapter (email,
 * SMS, push) and is injected into handlers that need to notify a customer.
 */
export interface NotificationGatewayPort {
  send(params: {
    recipientId: string;
    channel: 'email' | 'sms' | 'push';
    templateId: string;
    variables: Record<string, string>;
  }): Promise<{ deliveryId: string; sentAt: Date }>;
}

export const NOTIFICATION_GATEWAY_PORT = Symbol('NotificationGatewayPort');
