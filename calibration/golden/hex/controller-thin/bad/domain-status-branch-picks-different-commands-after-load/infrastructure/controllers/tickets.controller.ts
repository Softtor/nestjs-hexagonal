import { Body, Controller, ConflictException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { GetTicketQuery } from '../../application/queries/get-ticket.query';
import { ReopenTicketCommand } from '../../application/commands/reopen-ticket.command';
import { EscalateTicketCommand } from '../../application/commands/escalate-ticket.command';
import type { TicketOutputDto } from '../../application/dtos/ticket-output.mapper';
import { UpdateTicketRequestDto } from './dtos/update-ticket.request.dto';
import { JwtAuthGuard } from '@/shared/infrastructure/auth/jwt-auth.guard';

@ApiTags('Tickets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations/:organizationId/tickets')
export class TicketsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post(':ticketId/update')
  @ApiOperation({ summary: 'Reopen or escalate a ticket depending on its state' })
  @ApiOkResponse({ description: 'Ticket updated' })
  async update(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() dto: UpdateTicketRequestDto,
  ): Promise<TicketOutputDto> {
    const ticket = await this.queryBus.execute(new GetTicketQuery(ticketId, organizationId));
    if (ticket.status === 'CLOSED') {
      throw new ConflictException('Closed tickets cannot be updated');
    }
    if (ticket.status === 'ESCALATED') {
      return this.commandBus.execute(new ReopenTicketCommand(ticketId, organizationId, dto.reason));
    }
    return this.commandBus.execute(new EscalateTicketCommand(ticketId, organizationId, dto.reason));
  }
}
