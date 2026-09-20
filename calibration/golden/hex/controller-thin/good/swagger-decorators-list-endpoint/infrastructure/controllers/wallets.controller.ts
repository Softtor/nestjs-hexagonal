import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { QueryBus } from '@nestjs/cqrs';
import { ListWalletTransactionsQuery } from '../../application/queries/list-wallet-transactions.query';
import type { WalletTransactionListOutputDto } from '../../application/dtos/wallet-transaction-output.mapper';
import { ListWalletTransactionsRequestDto } from './dtos/list-wallet-transactions.request.dto';
import { JwtAuthGuard } from '@/shared/infrastructure/auth/jwt-auth.guard';

@ApiTags('Wallets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations/:organizationId/wallets/:walletId/transactions')
export class WalletsController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get()
  @ApiOperation({ summary: 'List transactions for a wallet' })
  @ApiOkResponse({ description: 'Paginated list of wallet transactions' })
  async list(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('walletId', ParseUUIDPipe) walletId: string,
    @Query() query: ListWalletTransactionsRequestDto,
  ): Promise<WalletTransactionListOutputDto> {
    return this.queryBus.execute(
      new ListWalletTransactionsQuery(organizationId, walletId, query.page, query.perPage, query.type),
    );
  }
}
