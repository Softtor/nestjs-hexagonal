import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  APPOINTMENT_REPOSITORY_TOKEN,
  AppointmentRepository,
} from '../../domain/repositories/appointment.repository';
import { AppointmentNotFoundError } from '../../domain/errors/appointment-not-found.error';
import { AppointmentOutputMapper, type AppointmentOutputDto } from '../dtos/appointment-output.mapper';
import { GetAppointmentQuery } from './get-appointment.query';

@QueryHandler(GetAppointmentQuery)
export class GetAppointmentHandler
  implements IQueryHandler<GetAppointmentQuery, AppointmentOutputDto>
{
  constructor(
    @Inject(APPOINTMENT_REPOSITORY_TOKEN)
    private readonly repository: AppointmentRepository.Repository,
  ) {}

  async execute(query: GetAppointmentQuery): Promise<AppointmentOutputDto> {
    const appointment = await this.repository.findById(query.appointmentId);

    if (!appointment || appointment.organizationId !== query.organizationId) {
      throw new AppointmentNotFoundError(query.appointmentId);
    }

    return AppointmentOutputMapper.toOutput(appointment);
  }
}
