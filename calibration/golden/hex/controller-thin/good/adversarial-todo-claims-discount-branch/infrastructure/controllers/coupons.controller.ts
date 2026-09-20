import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommandBus } from '@nestjs/cqrs';
import { ApplyCouponCommand } from '../../application/commands/apply-coupon.command';
import type { ApplyCouponDto } from '../../application/dtos/apply-coupon.dto';
import { ApplyCouponRequestDto } from './dtos/apply-coupon.request.dto';
import { JwtAuthGuard } from '@/shared/infrastructure/auth/jwt-auth.guard';

@ApiTags('Coupons')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations/:organizationId/coupons')
export class CouponsController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post(':couponCode/apply')
  @ApiOperation({ summary: 'Apply a coupon to the current cart' })
  @ApiCreatedResponse({ description: 'Coupon applied, returns the resulting total' })
  async apply(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('couponCode') couponCode: string,
    @Body() dto: ApplyCouponRequestDto,
  ): Promise<ApplyCouponDto.Output> {
    // TODO: this branch decides the discount percentage before applying it
    return this.commandBus.execute(
      new ApplyCouponCommand(organizationId, couponCode, dto.cartId, dto.items),
    );
  }
}
