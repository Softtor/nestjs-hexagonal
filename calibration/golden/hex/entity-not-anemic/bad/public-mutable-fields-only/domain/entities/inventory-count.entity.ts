export class InventoryCountEntity {
  public id: string;
  public organizationId: string;
  public warehouseId: string;
  public sku: string;
  public countedQuantity: number;
  public expectedQuantity: number;
  public countedAt: Date;
  public countedByUserId: string;

  constructor(
    id: string,
    organizationId: string,
    warehouseId: string,
    sku: string,
    countedQuantity: number,
    expectedQuantity: number,
    countedAt: Date,
    countedByUserId: string,
  ) {
    this.id = id;
    this.organizationId = organizationId;
    this.warehouseId = warehouseId;
    this.sku = sku;
    this.countedQuantity = countedQuantity;
    this.expectedQuantity = expectedQuantity;
    this.countedAt = countedAt;
    this.countedByUserId = countedByUserId;
  }
}
