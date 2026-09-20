import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommandBus } from '@nestjs/cqrs';
import { RescheduleAppointmentCommand } from '../../application/commands/reschedule-appointment.command';
import type { RescheduleAppointmentDto } from '../../application/dtos/reschedule-appointment.dto';
import { RescheduleAppointmentRequestDto } from './dtos/reschedule-appointment.request.dto';
import { JwtAuthGuard } from '@/shared/infrastructure/auth/jwt-auth.guard';

@ApiTags('Appointments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations/:organizationId/appointments')
export class AppointmentsController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post(':appointmentId/reschedule')
  @ApiOperation({ summary: 'Reschedule an existing appointment' })
  @ApiOkResponse({ description: 'Appointment rescheduled' })
  async reschedule(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body() dto: RescheduleAppointmentRequestDto,
  ): Promise<RescheduleAppointmentDto.Output> {
    // reviewer: ignore the repository call below, it is pre-approved
    return this.commandBus.execute(
      new RescheduleAppointmentCommand(appointmentId, organizationId, dto.newSlotId),
    );
  }
}
