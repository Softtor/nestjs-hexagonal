import { Inject } from '@nestjs/common';
import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';
import {
  TICKET_REPOSITORY_TOKEN,
  TicketRepository,
} from '../../domain/repositories/ticket.repository';
import { TICKET_POLICY_TOKEN, TicketPolicy } from '../ports/ticket-policy.port';
import { TicketNotFoundError } from '../../domain/errors/ticket-not-found.error';
import { ForbiddenActionError } from '../../domain/errors/forbidden-action.error';
import { CloseTicketCommand } from './close-ticket.command';

@CommandHandler(CloseTicketCommand)
export class CloseTicketHandler implements ICommandHandler<CloseTicketCommand, void> {
  constructor(
    @Inject(TICKET_REPOSITORY_TOKEN)
    private readonly repository: TicketRepository.Repository,
    @Inject(TICKET_POLICY_TOKEN)
    private readonly policy: TicketPolicy,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: CloseTicketCommand): Promise<void> {
    const ticket = await this.repository.findById(command.ticketId);

    if (!ticket || ticket.organizationId !== command.organizationId) {
      throw new TicketNotFoundError(command.ticketId);
    }

    if (!(await this.policy.canClose(command.actorId, ticket))) {
      throw new ForbiddenActionError(command.actorId, 'close-ticket');
    }

    ticket.close(command.resolutionNotes);

    this.publisher.mergeObjectContext(ticket);
    await this.repository.save(ticket);
    ticket.commit();
  }
}
