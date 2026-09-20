import { Inject } from '@nestjs/common';
import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';
import {
  WALLET_REPOSITORY_TOKEN,
  WalletRepository,
} from '../../domain/repositories/wallet.repository';
import { WalletNotFoundError } from '../../domain/errors/wallet-not-found.error';
import { WithdrawFundsCommand } from './withdraw-funds.command';

@CommandHandler(WithdrawFundsCommand)
export class WithdrawFundsHandler implements ICommandHandler<WithdrawFundsCommand, void> {
  constructor(
    @Inject(WALLET_REPOSITORY_TOKEN)
    private readonly repository: WalletRepository.Repository,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: WithdrawFundsCommand): Promise<void> {
    const wallet = await this.repository.findById(command.walletId);

    if (!wallet || wallet.organizationId !== command.organizationId) {
      throw new WalletNotFoundError(command.walletId);
    }

    let feeRate = 0.02;
    if (wallet.tier === 'gold') {
      feeRate = 0.01;
    } else if (wallet.tier === 'platinum') {
      feeRate = 0;
    }

    const fee = command.amount * feeRate;

    wallet.withdraw(command.amount, fee);

    this.publisher.mergeObjectContext(wallet);
    await this.repository.save(wallet);
    wallet.commit();
  }
}
