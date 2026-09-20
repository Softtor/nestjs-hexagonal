import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/shared/database/prisma.service';
import { CreateAppointmentHandler } from '../commands/create-appointment.handler';
import { SendAppointmentConfirmationHandler } from '../commands/send-appointment-confirmation.handler';
import type { ScheduleAppointmentDto } from '../dtos/schedule-appointment.dto';

@Injectable()
export class AppointmentSchedulingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly createAppointmentHandler: CreateAppointmentHandler,
    private readonly sendConfirmationHandler: SendAppointmentConfirmationHandler,
  ) {}

  async schedule(dto: ScheduleAppointmentDto): Promise<{ id: string }> {
    return this.prisma.$transaction(async () => {
      const created = await this.createAppointmentHandler.execute({
        organizationId: dto.organizationId,
        customerId: dto.customerId,
        slotStart: dto.slotStart,
        slotEnd: dto.slotEnd,
      });

      await this.sendConfirmationHandler.execute({
        appointmentId: created.id,
        channel: dto.confirmationChannel,
      });

      return created;
    });
  }
}
