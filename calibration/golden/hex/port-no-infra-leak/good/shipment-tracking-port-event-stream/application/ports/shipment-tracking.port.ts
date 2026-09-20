export interface ShipmentTrackingEvent {
  shipmentId: string;
  status: 'picked-up' | 'in-transit' | 'delivered' | 'exception';
  occurredAt: Date;
  location: string | null;
}

export interface ShipmentTrackingPort {
  stream(shipmentId: string): AsyncIterable<ShipmentTrackingEvent>;
  latest(shipmentId: string): Promise<ShipmentTrackingEvent | null>;
}

export const SHIPMENT_TRACKING_PORT = Symbol('ShipmentTrackingPort');
