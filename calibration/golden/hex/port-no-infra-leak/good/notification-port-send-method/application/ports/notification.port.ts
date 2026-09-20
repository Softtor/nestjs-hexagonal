import { UniqueEntityID } from '@/shared/domain/unique-entity-id';

export interface NotificationRecipient {
  contactId: UniqueEntityID;
  channel: 'email' | 'sms' | 'push';
  address: string;
}

export interface NotificationMessage {
  subject: string;
  body: string;
  scheduledFor: Date | null;
}

export interface NotificationPort {
  send(
    recipient: NotificationRecipient,
    message: NotificationMessage,
  ): Promise<{ deliveredAt: Date; accepted: boolean }>;
}

export const NOTIFICATION_PORT = Symbol('NotificationPort');
