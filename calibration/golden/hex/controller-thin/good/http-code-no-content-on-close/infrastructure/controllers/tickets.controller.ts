import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommandBus } from '@nestjs/cqrs';
import { CloseTicketCommand } from '../../application/commands/close-ticket.command';
import { CloseTicketRequestDto } from './dtos/close-ticket.request.dto';
import { JwtAuthGuard } from '@/shared/infrastructure/auth/jwt-auth.guard';

@ApiTags('Tickets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations/:organizationId/tickets')
export class TicketsController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post(':ticketId/close')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Close a support ticket' })
  @ApiNoContentResponse({ description: 'Ticket closed' })
  async close(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() dto: CloseTicketRequestDto,
  ): Promise<void> {
    await this.commandBus.execute(new CloseTicketCommand(ticketId, organizationId, dto.resolution));
  }
}
