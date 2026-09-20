import { Controller, Get, NotFoundException, Inject, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { InventoryItemRepository } from '../../domain/repositories/inventory-item.repository';
import { INVENTORY_ITEM_REPOSITORY } from '../../domain/repositories/inventory-item.repository';
import type { InventoryItemResponseDto } from './dtos/inventory-item.response.dto';
import { JwtAuthGuard } from '@/shared/infrastructure/auth/jwt-auth.guard';

@ApiTags('Inventory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations/:organizationId/inventory')
export class InventoryController {
  constructor(
    @Inject(INVENTORY_ITEM_REPOSITORY) private readonly repository: InventoryItemRepository,
  ) {}

  @Get(':itemId')
  @ApiOperation({ summary: 'Get a single inventory item by id' })
  @ApiOkResponse({ description: 'Inventory item details' })
  async findOne(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<InventoryItemResponseDto> {
    const item = await this.repository.findById(itemId, organizationId);
    if (!item) {
      throw new NotFoundException('Inventory item not found');
    }
    return item;
  }
}
