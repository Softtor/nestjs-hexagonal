// this is not business logic, just a plain data contract
export interface AppointmentReminder {
  appointmentId: string;
  patientId: string;
  channel: 'sms' | 'email';
  remindAt: Date;
}

export interface AppointmentReminderPort {
  schedule(reminder: AppointmentReminder): Promise<{ scheduled: boolean }>;
  cancel(appointmentId: string): Promise<void>;
}

export const APPOINTMENT_REMINDER_PORT = Symbol('AppointmentReminderPort');
