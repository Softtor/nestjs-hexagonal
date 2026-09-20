import { Body, Controller, Inject, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ShipmentEntity } from '../../domain/entities/shipment.entity';
import type { ShipmentRepository } from '../../domain/repositories/shipment.repository';
import { SHIPMENT_REPOSITORY } from '../../domain/repositories/shipment.repository';
import { CreateShipmentRequestDto } from './dtos/create-shipment.request.dto';
import { JwtAuthGuard } from '@/shared/infrastructure/auth/jwt-auth.guard';

@ApiTags('Shipments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations/:organizationId/shipments')
export class ShipmentsController {
  constructor(
    @Inject(SHIPMENT_REPOSITORY) private readonly shipmentRepository: ShipmentRepository,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new shipment' })
  @ApiCreatedResponse({ description: 'Shipment created, returns its id' })
  async create(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateShipmentRequestDto,
  ): Promise<{ id: string }> {
    const shipment = ShipmentEntity.create({
      organizationId,
      orderId: dto.orderId,
      carrier: dto.carrier,
      destinationAddress: dto.destinationAddress,
    });
    await this.shipmentRepository.save(shipment);
    return { id: shipment.id };
  }
}
