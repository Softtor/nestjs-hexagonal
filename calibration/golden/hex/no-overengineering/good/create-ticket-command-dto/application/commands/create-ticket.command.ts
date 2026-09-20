import { Command } from '@nestjs/cqrs';

export interface CreateTicketAttachment {
  fileName: string;
  url: string;
}

export class CreateTicketCommand extends Command<{ id: string }> {
  constructor(
    public readonly organizationId: string,
    public readonly requesterId: string,
    public readonly subject: string,
    public readonly description: string,
    public readonly priority: 'low' | 'normal' | 'high' | 'urgent',
    public readonly attachments: CreateTicketAttachment[] = [],
  ) {
    super();
  }
}
