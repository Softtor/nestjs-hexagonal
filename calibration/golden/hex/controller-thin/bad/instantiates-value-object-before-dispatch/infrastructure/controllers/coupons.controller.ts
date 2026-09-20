import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommandBus } from '@nestjs/cqrs';
import { MoneyVO } from '../../domain/value-objects/money.vo';
import { CreateCouponCommand } from '../../application/commands/create-coupon.command';
import type { CreateCouponDto } from '../../application/dtos/create-coupon.dto';
import { CreateCouponRequestDto } from './dtos/create-coupon.request.dto';
import { JwtAuthGuard } from '@/shared/infrastructure/auth/jwt-auth.guard';

@ApiTags('Coupons')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations/:organizationId/coupons')
export class CouponsController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post()
  @ApiOperation({ summary: 'Create a new fixed-amount coupon' })
  @ApiCreatedResponse({ description: 'Coupon created, returns its id' })
  async create(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateCouponRequestDto,
  ): Promise<CreateCouponDto.Output> {
    const discount = MoneyVO.create(dto.discountAmount, dto.currency);
    return this.commandBus.execute(
      new CreateCouponCommand(organizationId, dto.code, discount, dto.expiresAt),
    );
  }
}
