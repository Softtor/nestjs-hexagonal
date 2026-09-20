export interface MailPort {
  send(to: string, body: string): Promise<void>;
}

export const MAIL_PORT = Symbol('MailPort');
