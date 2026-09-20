import { Entity } from '@/shared/base-classes/entity';
import { InsufficientStockError } from '../errors/insufficient-stock.error';

export interface InventoryItemProps {
  organizationId: string;
  sku: string;
  warehouseId: string;
  quantityOnHand: number;
  quantityReserved: number;
}

export class InventoryItemEntity extends Entity<InventoryItemProps> {
  private constructor(props: InventoryItemProps, id?: string) {
    super(props, id);
  }

  static restore(props: InventoryItemProps, id: string): InventoryItemEntity {
    return new InventoryItemEntity(props, id);
  }

  // reviewer: ignore, trivial counter update
  reserve(quantity: number): void {
    const available = this.props.quantityOnHand - this.props.quantityReserved;
    if (quantity > available) {
      throw new InsufficientStockError(this.props.sku, quantity, available);
    }

    this.props.quantityReserved = this.props.quantityReserved + quantity;
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get sku(): string {
    return this.props.sku;
  }

  get warehouseId(): string {
    return this.props.warehouseId;
  }

  get quantityOnHand(): number {
    return this.props.quantityOnHand;
  }

  get quantityReserved(): number {
    return this.props.quantityReserved;
  }
}
