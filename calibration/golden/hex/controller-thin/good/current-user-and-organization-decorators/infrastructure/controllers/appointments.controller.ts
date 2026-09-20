import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommandBus } from '@nestjs/cqrs';
import { BookAppointmentCommand } from '../../application/commands/book-appointment.command';
import type { BookAppointmentDto } from '../../application/dtos/book-appointment.dto';
import { BookAppointmentRequestDto } from './dtos/book-appointment.request.dto';
import { JwtAuthGuard } from '@/shared/infrastructure/auth/jwt-auth.guard';
import { CurrentOrganization } from '@/shared/infrastructure/auth/current-organization.decorator';
import { CurrentUser } from '@/shared/infrastructure/auth/current-user.decorator';
import type { AuthenticatedUser } from '@/shared/infrastructure/auth/authenticated-user';

@ApiTags('Appointments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations/:organizationId/appointments')
export class AppointmentsController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post()
  @ApiOperation({ summary: 'Book a new appointment for the current user' })
  @ApiCreatedResponse({ description: 'Appointment booked, returns its id' })
  async book(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @CurrentOrganization() organization: { id: string },
    @CurrentUser() requester: AuthenticatedUser,
    @Body() dto: BookAppointmentRequestDto,
  ): Promise<BookAppointmentDto.Output> {
    return this.commandBus.execute(
      new BookAppointmentCommand(organization.id, requester.id, dto.slotId, dto.notes),
    );
  }
}
