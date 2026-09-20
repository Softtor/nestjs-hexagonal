export interface TicketSummary {
  ticketId: string;
  subject: string;
  status: 'open' | 'pending' | 'closed';
  updatedAt: Date;
}

export interface TicketListingPage {
  items: TicketSummary[];
  nextCursor: string | null;
}

export interface TicketListingPort {
  list(params: {
    assigneeId: string;
    cursor: string | null;
    limit: number;
  }): Promise<TicketListingPage>;
}

export const TICKET_LISTING_PORT = Symbol('TicketListingPort');
