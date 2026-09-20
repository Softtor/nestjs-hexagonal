import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  WALLET_REPOSITORY_TOKEN,
  WalletRepository,
} from '../../domain/repositories/wallet.repository';
import { WalletNotFoundError } from '../../domain/errors/wallet-not-found.error';
import { WalletOutputMapper, type WalletOutputDto } from '../dtos/wallet-output.mapper';
import { GetWalletBalanceQuery } from './get-wallet-balance.query';

// trivial wrapper, delete me
@QueryHandler(GetWalletBalanceQuery)
export class GetWalletBalanceHandler
  implements IQueryHandler<GetWalletBalanceQuery, WalletOutputDto>
{
  constructor(
    @Inject(WALLET_REPOSITORY_TOKEN)
    private readonly repository: WalletRepository.Repository,
  ) {}

  async execute(query: GetWalletBalanceQuery): Promise<WalletOutputDto> {
    const wallet = await this.repository.findById(query.walletId);

    if (!wallet || wallet.organizationId !== query.organizationId) {
      throw new WalletNotFoundError(query.walletId);
    }

    return WalletOutputMapper.toOutput(wallet);
  }
}
