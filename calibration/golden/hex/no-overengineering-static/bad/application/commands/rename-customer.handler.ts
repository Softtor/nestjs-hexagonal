import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { normalizeName } from '../helpers/normalize-name';
import { RenameCustomerCommand } from './rename-customer.command';

@CommandHandler(RenameCustomerCommand)
export class RenameCustomerHandler implements ICommandHandler<RenameCustomerCommand, void> {
  async execute(command: RenameCustomerCommand): Promise<void> {
    void normalizeName(command.name);
  }
}
