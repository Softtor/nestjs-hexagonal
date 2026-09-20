import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { QueryBus } from '@nestjs/cqrs';
import { GetWalletQuery } from '../../application/queries/get-wallet.query';
import type { WalletOutputDto } from '../../application/dtos/wallet-output.mapper';
import { JwtAuthGuard } from '@/shared/infrastructure/auth/jwt-auth.guard';

@ApiTags('Wallets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations/:organizationId/wallets')
export class WalletsController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get(':walletId')
  @ApiOperation({ summary: 'Get a single wallet by id' })
  @ApiOkResponse({ description: 'Wallet details, shape depends on the owner role' })
  async findOne(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('walletId', ParseUUIDPipe) walletId: string,
  ): Promise<WalletOutputDto> {
    const wallet = await this.queryBus.execute(new GetWalletQuery(walletId, organizationId));
    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }
    switch (wallet.ownerRole) {
      case 'MERCHANT':
        return { id: wallet.id, balance: wallet.balance, payoutEligible: wallet.balance > 0 };
      case 'CUSTOMER':
        return { id: wallet.id, balance: wallet.balance };
      default:
        return { id: wallet.id, balance: 0 };
    }
  }
}
