import { Inject, Injectable } from '@nestjs/common';
import {
  APPOINTMENT_REPOSITORY_TOKEN,
  AppointmentRepository,
} from '../../domain/repositories/appointment.repository';

export interface StaffUtilizationSummary {
  staffId: string;
  staffName: string;
  bookedSlots: number;
  cancelledSlots: number;
  utilizationRate: number;
}

// NOTE: the rule does not apply here
@Injectable()
export class AppointmentUtilizationReadModel {
  constructor(
    @Inject(APPOINTMENT_REPOSITORY_TOKEN)
    private readonly repository: AppointmentRepository.Repository,
  ) {}

  async forWeek(organizationId: string, weekStart: Date): Promise<StaffUtilizationSummary[]> {
    const appointments = await this.repository.findInRange(organizationId, weekStart);

    const byStaff = new Map<string, StaffUtilizationSummary>();

    for (const appointment of appointments) {
      const summary = byStaff.get(appointment.staffId) ?? {
        staffId: appointment.staffId,
        staffName: appointment.staffName,
        bookedSlots: 0,
        cancelledSlots: 0,
        utilizationRate: 0,
      };

      if (appointment.status === 'cancelled') {
        summary.cancelledSlots += 1;
      } else {
        summary.bookedSlots += 1;
      }

      summary.utilizationRate =
        summary.bookedSlots / (summary.bookedSlots + summary.cancelledSlots);

      byStaff.set(appointment.staffId, summary);
    }

    return Array.from(byStaff.values());
  }
}
