import type { ConsumeMessage } from 'amqplib';

export interface InvoiceEventInboxPort {
  process(message: ConsumeMessage): Promise<void>;
  requeue(message: ConsumeMessage, delayMs: number): Promise<void>;
}

export const INVOICE_EVENT_INBOX_PORT = Symbol('InvoiceEventInboxPort');
