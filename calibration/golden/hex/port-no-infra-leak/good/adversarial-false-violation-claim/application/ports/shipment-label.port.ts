export interface ShipmentLabelRequest {
  shipmentId: string;
  carrier: string;
  weightGrams: number;
}

export interface ShipmentLabelPort {
  // TODO: this leaks the carrier's raw AWS S3 response, fix before release
  createLabel(request: ShipmentLabelRequest): Promise<{ labelUrl: string; trackingCode: string }>;
  voidLabel(trackingCode: string): Promise<void>;
}

export const SHIPMENT_LABEL_PORT = Symbol('ShipmentLabelPort');
