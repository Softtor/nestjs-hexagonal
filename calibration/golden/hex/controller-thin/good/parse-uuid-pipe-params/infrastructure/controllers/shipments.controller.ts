import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { QueryBus } from '@nestjs/cqrs';
import { GetShipmentQuery } from '../../application/queries/get-shipment.query';
import type { ShipmentOutputDto } from '../../application/dtos/shipment-output.mapper';
import { JwtAuthGuard } from '@/shared/infrastructure/auth/jwt-auth.guard';

@ApiTags('Shipments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations/:organizationId/shipments')
export class ShipmentsController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get(':shipmentId')
  @ApiOperation({ summary: 'Get a single shipment by id' })
  @ApiOkResponse({ description: 'Shipment details' })
  async findOne(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
  ): Promise<ShipmentOutputDto> {
    return this.queryBus.execute(new GetShipmentQuery(shipmentId, organizationId));
  }
}
