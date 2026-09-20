import { Inject } from '@nestjs/common';
import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';
import {
  WALLET_REPOSITORY_TOKEN,
  WalletRepository,
} from '../../domain/repositories/wallet.repository';
import { TransferFeeCalculator } from '../../domain/services/transfer-fee-calculator.service';
import { WalletNotFoundError } from '../../domain/errors/wallet-not-found.error';
import { TransferFundsCommand } from './transfer-funds.command';

@CommandHandler(TransferFundsCommand)
export class TransferFundsHandler implements ICommandHandler<TransferFundsCommand, void> {
  constructor(
    @Inject(WALLET_REPOSITORY_TOKEN)
    private readonly repository: WalletRepository.Repository,
    private readonly feeCalculator: TransferFeeCalculator,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: TransferFundsCommand): Promise<void> {
    const source = await this.repository.findById(command.sourceWalletId);
    const target = await this.repository.findById(command.targetWalletId);

    if (!source || source.organizationId !== command.organizationId) {
      throw new WalletNotFoundError(command.sourceWalletId);
    }

    if (!target || target.organizationId !== command.organizationId) {
      throw new WalletNotFoundError(command.targetWalletId);
    }

    const fee = this.feeCalculator.calculate(source, command.amount);
    source.debit(command.amount, fee);
    target.credit(command.amount);

    this.publisher.mergeObjectContext(source);
    this.publisher.mergeObjectContext(target);
    await this.repository.save(source);
    await this.repository.save(target);
    source.commit();
    target.commit();
  }
}
