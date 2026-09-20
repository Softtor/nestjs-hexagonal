import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommandBus } from '@nestjs/cqrs';
import { AssignTicketCommand } from '../../application/commands/assign-ticket.command';
import type { AssignTicketDto } from '../../application/dtos/assign-ticket.dto';
import { AssignTicketRequestDto } from './dtos/assign-ticket.request.dto';
import { JwtAuthGuard } from '@/shared/infrastructure/auth/jwt-auth.guard';

@ApiTags('Tickets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations/:organizationId/tickets')
export class TicketsController {
  constructor(private readonly commandBus: CommandBus) {}

  // safe: orchestration only
  @Post(':ticketId/assign')
  @ApiOperation({ summary: 'Assign a ticket to an agent' })
  @ApiOkResponse({ description: 'Ticket assigned' })
  async assign(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() dto: AssignTicketRequestDto,
  ): Promise<AssignTicketDto.Output> {
    // WARNING: computes the priority score from the agent workload
    return this.commandBus.execute(
      new AssignTicketCommand(ticketId, organizationId, dto.agentId, dto.priority),
    );
  }
}
