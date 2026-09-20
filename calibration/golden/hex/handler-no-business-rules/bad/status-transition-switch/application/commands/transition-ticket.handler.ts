import { Inject } from '@nestjs/common';
import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';
import {
  TICKET_REPOSITORY_TOKEN,
  TicketRepository,
} from '../../domain/repositories/ticket.repository';
import { TicketNotFoundError } from '../../domain/errors/ticket-not-found.error';
import { TransitionTicketCommand } from './transition-ticket.command';

@CommandHandler(TransitionTicketCommand)
export class TransitionTicketHandler
  implements ICommandHandler<TransitionTicketCommand, void>
{
  constructor(
    @Inject(TICKET_REPOSITORY_TOKEN)
    private readonly repository: TicketRepository.Repository,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: TransitionTicketCommand): Promise<void> {
    const ticket = await this.repository.findById(command.ticketId);

    if (!ticket || ticket.organizationId !== command.organizationId) {
      throw new TicketNotFoundError(command.ticketId);
    }

    switch (ticket.status) {
      case 'open':
        ticket.status = 'in-progress';
        break;
      case 'in-progress':
        ticket.status = command.resolved ? 'resolved' : 'waiting-on-customer';
        break;
      case 'waiting-on-customer':
        ticket.status = 'in-progress';
        break;
      default:
        break;
    }

    this.publisher.mergeObjectContext(ticket);
    await this.repository.save(ticket);
    ticket.commit();
  }
}
