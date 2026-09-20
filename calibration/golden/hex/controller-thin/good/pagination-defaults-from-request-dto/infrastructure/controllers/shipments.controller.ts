import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { QueryBus } from '@nestjs/cqrs';
import { ListShipmentsQuery } from '../../application/queries/list-shipments.query';
import type { ShipmentListOutputDto } from '../../application/dtos/shipment-output.mapper';
import { ListShipmentsRequestDto } from './dtos/list-shipments.request.dto';
import { JwtAuthGuard } from '@/shared/infrastructure/auth/jwt-auth.guard';

@ApiTags('Shipments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations/:organizationId/shipments')
export class ShipmentsController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get()
  @ApiOperation({ summary: 'List shipments with pagination' })
  @ApiOkResponse({ description: 'Paginated list of shipments' })
  async list(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Query() query: ListShipmentsRequestDto,
  ): Promise<ShipmentListOutputDto> {
    return this.queryBus.execute(
      new ListShipmentsQuery(organizationId, query.page, query.perPage, query.status),
    );
  }
}
