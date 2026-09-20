import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT_TOKEN } from '@/shared/cache/redis-client.token';
import {
  TICKET_REPOSITORY_TOKEN,
  TicketRepository,
} from '../../domain/repositories/ticket.repository';
import { TicketEntity } from '../../domain/entities/ticket.entity';

@Injectable()
export class TicketSummaryReadModel {
  constructor(
    @Inject(REDIS_CLIENT_TOKEN) private readonly redis: Redis,
    @Inject(TICKET_REPOSITORY_TOKEN)
    private readonly repository: TicketRepository.Repository,
  ) {}

  async get(ticketId: string): Promise<TicketEntity | null> {
    const cached = await this.redis.get(`ticket-summary:${ticketId}`);

    if (cached) {
      return TicketEntity.restore(JSON.parse(cached), ticketId);
    }

    const ticket = await this.repository.findById(ticketId);

    if (ticket) {
      await this.redis.set(`ticket-summary:${ticketId}`, JSON.stringify(ticket), 'EX', 300);
    }

    return ticket;
  }
}
