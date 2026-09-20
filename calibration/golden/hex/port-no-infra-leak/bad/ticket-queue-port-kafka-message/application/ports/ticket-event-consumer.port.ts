import type { KafkaMessage } from 'kafkajs';

export interface TicketEventConsumerPort {
  handleIncoming(message: KafkaMessage): Promise<void>;
  handleBatch(messages: KafkaMessage[]): Promise<void>;
}

export const TICKET_EVENT_CONSUMER_PORT = Symbol('TicketEventConsumerPort');
