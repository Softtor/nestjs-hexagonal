import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommandBus } from '@nestjs/cqrs';
import { CancelSubscriptionCommand } from '../../application/commands/cancel-subscription.command';
import { CancelSubscriptionRequestDto } from './dtos/cancel-subscription.request.dto';
import { JwtAuthGuard } from '@/shared/infrastructure/auth/jwt-auth.guard';
import { RolesGuard } from '@/shared/infrastructure/auth/roles.guard';
import { Roles } from '@/shared/infrastructure/auth/roles.decorator';

@ApiTags('Subscriptions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('organizations/:organizationId/subscriptions')
export class SubscriptionsController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post(':subscriptionId/cancel')
  @Roles('ADMIN', 'BILLING_MANAGER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel a subscription' })
  @ApiNoContentResponse({ description: 'Subscription cancelled' })
  async cancel(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
    @Body() dto: CancelSubscriptionRequestDto,
  ): Promise<void> {
    await this.commandBus.execute(
      new CancelSubscriptionCommand(subscriptionId, organizationId, dto.reason),
    );
  }
}
