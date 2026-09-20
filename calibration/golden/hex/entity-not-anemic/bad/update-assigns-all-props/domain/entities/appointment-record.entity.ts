import { Entity } from '@/shared/base-classes/entity';

export interface AppointmentRecordProps {
  organizationId: string;
  practitionerId: string;
  patientId: string;
  scheduledAt: Date;
  durationMinutes: number;
  notes?: string;
}

export class AppointmentRecordEntity extends Entity<AppointmentRecordProps> {
  private constructor(props: AppointmentRecordProps, id?: string) {
    super(props, id);
  }

  static restore(props: AppointmentRecordProps, id: string): AppointmentRecordEntity {
    return new AppointmentRecordEntity(props, id);
  }

  update(input: AppointmentRecordProps): void {
    this.props.organizationId = input.organizationId;
    this.props.practitionerId = input.practitionerId;
    this.props.patientId = input.patientId;
    this.props.scheduledAt = input.scheduledAt;
    this.props.durationMinutes = input.durationMinutes;
    this.props.notes = input.notes;
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
}
