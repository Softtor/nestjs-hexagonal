import type { ShipmentEntity } from '../../domain/entities/shipment.entity';

export interface ShipmentOutputDto {
  id: string;
  organizationId: string;
  orderId: string;
  carrier: string;
  trackingCode: string;
  status: string;
  shippedAt?: Date;
  deliveredAt?: Date;
}

export function toShipmentOutput(shipment: ShipmentEntity): ShipmentOutputDto {
  return {
    id: shipment.id,
    organizationId: shipment.organizationId,
    orderId: shipment.orderId,
    carrier: shipment.carrier,
    trackingCode: shipment.trackingCode,
    status: shipment.status,
    shippedAt: shipment.shippedAt,
    deliveredAt: shipment.deliveredAt,
  };
}
