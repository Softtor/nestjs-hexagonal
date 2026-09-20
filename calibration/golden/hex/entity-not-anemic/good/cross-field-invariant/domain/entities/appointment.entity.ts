import { Entity } from '@/shared/base-classes/entity';
import { AppointmentConflictError } from '../errors/appointment-conflict.error';

export interface AppointmentProps {
  organizationId: string;
  practitionerId: string;
  patientId: string;
  scheduledAt: Date;
  durationMinutes: number;
  blackoutStart: Date;
  blackoutEnd: Date;
}

export class AppointmentEntity extends Entity<AppointmentProps> {
  private constructor(props: AppointmentProps, id?: string) {
    super(props, id);
  }

  static restore(props: AppointmentProps, id: string): AppointmentEntity {
    return new AppointmentEntity(props, id);
  }

  reschedule(newScheduledAt: Date): void {
    if (newScheduledAt >= this.props.blackoutStart && newScheduledAt <= this.props.blackoutEnd) {
      throw new AppointmentConflictError(this.id, 'target slot falls inside a blackout window');
    }

    this.props.scheduledAt = newScheduledAt;
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get practitionerId(): string {
    return this.props.practitionerId;
  }

  get patientId(): string {
    return this.props.patientId;
  }

  get scheduledAt(): Date {
    return this.props.scheduledAt;
  }

  get durationMinutes(): number {
    return this.props.durationMinutes;
  }
}
