export interface ClockPort {
  now(): Date;
  isBusinessDay(date: Date): boolean;
}

export const CLOCK_PORT = Symbol('ClockPort');
