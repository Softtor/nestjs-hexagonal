import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { GetSubscriptionQuery } from '../../application/queries/get-subscription.query';
import { PauseSubscriptionCommand } from '../../application/commands/pause-subscription.command';
import { CancelSubscriptionCommand } from '../../application/commands/cancel-subscription.command';
import type { SubscriptionOutputDto } from '../../application/dtos/subscription-output.mapper';
import { StopSubscriptionRequestDto } from './dtos/stop-subscription.request.dto';
import { JwtAuthGuard } from '@/shared/infrastructure/auth/jwt-auth.guard';

@ApiTags('Subscriptions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations/:organizationId/subscriptions')
export class SubscriptionsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post(':subscriptionId/stop')
  @ApiOperation({ summary: 'Stop a subscription, pausing or cancelling it' })
  @ApiOkResponse({ description: 'Subscription stopped' })
  async stop(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
    @Body() dto: StopSubscriptionRequestDto,
  ): Promise<SubscriptionOutputDto> {
    const subscription = await this.queryBus.execute(
      new GetSubscriptionQuery(subscriptionId, organizationId),
    );
    if (subscription.status === 'TRIAL') {
      return this.commandBus.execute(new PauseSubscriptionCommand(subscriptionId, organizationId));
    }
    return this.commandBus.execute(
      new CancelSubscriptionCommand(subscriptionId, organizationId, dto.reason),
    );
  }
}
