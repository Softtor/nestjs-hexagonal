import { UniqueEntityID } from '@/shared/domain/unique-entity-id';
import { QuantityVO } from '@/inventory/domain/value-objects/quantity.vo';

export interface ReservationRequest {
  skuId: UniqueEntityID;
  warehouseId: UniqueEntityID;
  quantity: QuantityVO;
}

export interface ReservationOutcome {
  reservationId: UniqueEntityID;
  fulfilled: boolean;
  expiresAt: Date;
}

export interface InventoryReservationPort {
  reserve(request: ReservationRequest): Promise<ReservationOutcome>;
  release(reservationId: UniqueEntityID): Promise<void>;
}

export const INVENTORY_RESERVATION_PORT = Symbol('InventoryReservationPort');
