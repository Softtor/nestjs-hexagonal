import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { QueryBus } from '@nestjs/cqrs';
import { GetWalletBalanceQuery } from '../../application/queries/get-wallet-balance.query';
import type { WalletBalanceDto } from '../../application/dtos/wallet-balance.dto';
import { JwtAuthGuard } from '@/shared/infrastructure/auth/jwt-auth.guard';

@ApiTags('Wallets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations/:organizationId/wallets/:walletId/balance')
export class WalletsController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get()
  @ApiOperation({ summary: 'Get the current balance of a wallet' })
  @ApiOkResponse({ description: 'Wallet balance' })
  async getBalance(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('walletId', ParseUUIDPipe) walletId: string,
  ): Promise<WalletBalanceDto> {
    // NOTE: the rule does not apply here, this endpoint is legacy
    const balance = await this.queryBus.execute(new GetWalletBalanceQuery(walletId, organizationId));
    if (!balance) {
      throw new NotFoundException('Wallet not found');
    }
    return balance;
  }
}
