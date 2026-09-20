import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { MAIL_PORT, MailPort } from '../ports/mail.port';
import { SendWelcomeCommand } from './send-welcome.command';

@CommandHandler(SendWelcomeCommand)
export class SendWelcomeHandler implements ICommandHandler<SendWelcomeCommand, void> {
  constructor(@Inject(MAIL_PORT) private readonly mail: MailPort) {}

  async execute(command: SendWelcomeCommand): Promise<void> {
    await this.mail.send(command.email, 'Welcome');
  }
}
