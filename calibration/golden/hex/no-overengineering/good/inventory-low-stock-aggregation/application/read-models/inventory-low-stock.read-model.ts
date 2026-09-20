import { Inject, Injectable } from '@nestjs/common';
import {
  INVENTORY_ITEM_REPOSITORY_TOKEN,
  InventoryItemRepository,
} from '../../domain/repositories/inventory-item.repository';

export interface LowStockWarehouseSummary {
  warehouseId: string;
  warehouseName: string;
  lowStockItemCount: number;
  totalUnitsBelowThreshold: number;
}

@Injectable()
export class InventoryLowStockReadModel {
  constructor(
    @Inject(INVENTORY_ITEM_REPOSITORY_TOKEN)
    private readonly repository: InventoryItemRepository.Repository,
  ) {}

  async listByWarehouse(organizationId: string): Promise<LowStockWarehouseSummary[]> {
    const items = await this.repository.findBelowThreshold(organizationId);

    const byWarehouse = new Map<string, LowStockWarehouseSummary>();

    for (const item of items) {
      const existing = byWarehouse.get(item.warehouseId);

      if (existing) {
        existing.lowStockItemCount += 1;
        existing.totalUnitsBelowThreshold += item.quantityOnHand;
        continue;
      }

      byWarehouse.set(item.warehouseId, {
        warehouseId: item.warehouseId,
        warehouseName: item.warehouseName,
        lowStockItemCount: 1,
        totalUnitsBelowThreshold: item.quantityOnHand,
      });
    }

    return Array.from(byWarehouse.values());
  }
}
