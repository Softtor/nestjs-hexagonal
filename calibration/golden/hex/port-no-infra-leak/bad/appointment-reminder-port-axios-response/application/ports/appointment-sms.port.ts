import type { AxiosResponse } from 'axios';

export interface AppointmentSmsSendResult {
  status: string;
  providerId: string;
}

export interface AppointmentSmsPort {
  sendReminder(
    appointmentId: string,
    phoneNumber: string,
  ): Promise<AxiosResponse<AppointmentSmsSendResult>>;
}

export const APPOINTMENT_SMS_PORT = Symbol('AppointmentSmsPort');
