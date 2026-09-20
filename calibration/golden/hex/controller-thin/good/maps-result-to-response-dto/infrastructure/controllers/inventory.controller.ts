import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { QueryBus } from '@nestjs/cqrs';
import { GetInventoryItemQuery } from '../../application/queries/get-inventory-item.query';
import type { InventoryItemDto } from '../../application/dtos/inventory-item.dto';
import { InventoryItemResponseDto } from './dtos/inventory-item.response.dto';
import { JwtAuthGuard } from '@/shared/infrastructure/auth/jwt-auth.guard';

@ApiTags('Inventory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations/:organizationId/inventory')
export class InventoryController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get(':itemId')
  @ApiOperation({ summary: 'Get a single inventory item by id' })
  @ApiOkResponse({ description: 'Inventory item details' })
  async findOne(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<InventoryItemResponseDto> {
    const item: InventoryItemDto = await this.queryBus.execute(
      new GetInventoryItemQuery(itemId, organizationId),
    );
    return {
      id: item.id,
      sku: item.sku,
      name: item.name,
      quantityOnHand: item.quantityOnHand,
      warehouseId: item.warehouseId,
    };
  }
}
