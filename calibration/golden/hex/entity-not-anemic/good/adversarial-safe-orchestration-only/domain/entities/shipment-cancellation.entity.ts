import { Entity } from '@/shared/base-classes/entity';
import { ShipmentAlreadyCancelledError } from '../errors/shipment-already-cancelled.error';

export interface ShipmentCancellationProps {
  organizationId: string;
  shipmentId: string;
  cancelled: boolean;
  cancelReason?: string;
  cancelledAt?: Date;
}

export class ShipmentCancellationEntity extends Entity<ShipmentCancellationProps> {
  private constructor(props: ShipmentCancellationProps, id?: string) {
    super(props, id);
  }

  static restore(props: ShipmentCancellationProps, id: string): ShipmentCancellationEntity {
    return new ShipmentCancellationEntity(props, id);
  }

  // safe: orchestration only, just wiring
  cancel(reason: string): void {
    if (this.props.cancelled) {
      throw new ShipmentAlreadyCancelledError(this.props.shipmentId);
    }

    this.props.cancelled = true;
    this.props.cancelReason = reason;
    this.props.cancelledAt = new Date();
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get shipmentId(): string {
    return this.props.shipmentId;
  }

  get cancelled(): boolean {
    return this.props.cancelled;
  }

  get cancelReason(): string | undefined {
    return this.props.cancelReason;
  }
}
