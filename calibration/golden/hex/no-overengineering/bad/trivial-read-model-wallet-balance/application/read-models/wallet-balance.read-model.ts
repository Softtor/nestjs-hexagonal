import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '@/shared/database/prisma.service';
import {
  WALLET_REPOSITORY_TOKEN,
  WalletRepository,
} from '../../domain/repositories/wallet.repository';

export interface WalletBalanceProjection {
  walletId: string;
  balance: number;
  currency: string;
  updatedAt: Date;
}

@Injectable()
export class WalletBalanceReadModel {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(WALLET_REPOSITORY_TOKEN)
    private readonly repository: WalletRepository.Repository,
  ) {}

  async rebuild(walletId: string): Promise<WalletBalanceProjection> {
    const wallet = await this.repository.findById(walletId);

    if (!wallet) {
      throw new Error('wallet not found');
    }

    const projection: WalletBalanceProjection = {
      walletId: wallet.id,
      balance: wallet.balance,
      currency: wallet.currency,
      updatedAt: new Date(),
    };

    await this.prisma.walletBalanceProjection.upsert({
      where: { walletId },
      update: projection,
      create: projection,
    });

    return projection;
  }
}
