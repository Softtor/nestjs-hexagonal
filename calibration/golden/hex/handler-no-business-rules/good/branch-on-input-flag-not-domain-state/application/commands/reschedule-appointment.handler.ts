import { Inject } from '@nestjs/common';
import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';
import {
  APPOINTMENT_REPOSITORY_TOKEN,
  AppointmentRepository,
} from '../../domain/repositories/appointment.repository';
import { NOTIFICATION_PORT_TOKEN, NotificationPort } from '../ports/notification.port';
import { AppointmentNotFoundError } from '../../domain/errors/appointment-not-found.error';
import { RescheduleAppointmentCommand } from './reschedule-appointment.command';

@CommandHandler(RescheduleAppointmentCommand)
export class RescheduleAppointmentHandler
  implements ICommandHandler<RescheduleAppointmentCommand, void>
{
  constructor(
    @Inject(APPOINTMENT_REPOSITORY_TOKEN)
    private readonly repository: AppointmentRepository.Repository,
    @Inject(NOTIFICATION_PORT_TOKEN)
    private readonly notifications: NotificationPort,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: RescheduleAppointmentCommand): Promise<void> {
    const appointment = await this.repository.findById(command.appointmentId);

    if (!appointment || appointment.organizationId !== command.organizationId) {
      throw new AppointmentNotFoundError(command.appointmentId);
    }

    appointment.reschedule(command.newStartTime);

    this.publisher.mergeObjectContext(appointment);
    await this.repository.save(appointment);
    appointment.commit();

    if (command.notifyCustomer) {
      await this.notifications.send(appointment.customerId, 'appointment-rescheduled');
    }
  }
}
