import { HttpStatus } from '@nestjs/common';

export interface MembershipWebhookAckPort {
  acknowledge(webhookId: string): Promise<HttpStatus>;
  reject(webhookId: string, reason: string): Promise<HttpStatus>;
}

export const MEMBERSHIP_WEBHOOK_ACK_PORT = Symbol('MembershipWebhookAckPort');
