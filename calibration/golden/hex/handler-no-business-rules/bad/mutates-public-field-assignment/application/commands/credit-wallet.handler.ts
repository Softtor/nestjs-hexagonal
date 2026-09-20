import { Inject } from '@nestjs/common';
import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';
import {
  WALLET_REPOSITORY_TOKEN,
  WalletRepository,
} from '../../domain/repositories/wallet.repository';
import { WalletNotFoundError } from '../../domain/errors/wallet-not-found.error';
import { CreditWalletCommand } from './credit-wallet.command';

@CommandHandler(CreditWalletCommand)
export class CreditWalletHandler implements ICommandHandler<CreditWalletCommand, void> {
  constructor(
    @Inject(WALLET_REPOSITORY_TOKEN)
    private readonly repository: WalletRepository.Repository,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: CreditWalletCommand): Promise<void> {
    const wallet = await this.repository.findById(command.walletId);

    if (!wallet || wallet.organizationId !== command.organizationId) {
      throw new WalletNotFoundError(command.walletId);
    }

    wallet.balance = wallet.balance + command.amount;

    this.publisher.mergeObjectContext(wallet);
    await this.repository.save(wallet);
    wallet.commit();
  }
}
