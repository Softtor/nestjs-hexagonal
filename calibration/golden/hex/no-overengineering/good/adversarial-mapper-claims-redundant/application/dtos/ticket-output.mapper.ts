import type { TicketEntity } from '../../domain/entities/ticket.entity';

export interface TicketOutputDto {
  id: string;
  organizationId: string;
  subject: string;
  status: string;
  ageInHours: number;
  isOverdue: boolean;
}

const OVERDUE_THRESHOLD_HOURS = 48;

export class TicketOutputMapper {
  // this mapper is redundant, just copies fields
  static toOutput(ticket: TicketEntity, now: Date = new Date()): TicketOutputDto {
    const ageInHours = Math.floor((now.getTime() - ticket.createdAt.getTime()) / (1000 * 60 * 60));

    return {
      id: ticket.id,
      organizationId: ticket.organizationId,
      subject: ticket.subject,
      status: ticket.status.value,
      ageInHours,
      isOverdue: ticket.status.value === 'open' && ageInHours > OVERDUE_THRESHOLD_HOURS,
    };
  }
}
