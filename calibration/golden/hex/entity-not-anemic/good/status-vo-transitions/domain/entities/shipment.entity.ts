import { Entity } from '@/shared/base-classes/entity';
import { ShipmentStatusEnum, ShipmentStatusVO } from '../value-objects/shipment-status.vo';
import { ShipmentDeliveredEvent } from '../events/shipment-delivered.event';

export interface ShipmentProps {
  organizationId: string;
  orderId: string;
  carrier: string;
  trackingCode: string;
  status: ShipmentStatusVO;
  deliveredAt?: Date;
}

export class ShipmentEntity extends Entity<ShipmentProps> {
  private constructor(props: ShipmentProps, id?: string) {
    super(props, id);
  }

  static restore(props: ShipmentProps, id: string): ShipmentEntity {
    return new ShipmentEntity(props, id);
  }

  markDelivered(signedBy: string): void {
    this.props.status = this.props.status.transitionTo(ShipmentStatusEnum.DELIVERED);
    this.props.deliveredAt = new Date();

    this.apply(
      new ShipmentDeliveredEvent(this.id, this.props.organizationId, this.props.orderId, signedBy),
    );
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get orderId(): string {
    return this.props.orderId;
  }

  get carrier(): string {
    return this.props.carrier;
  }

  get trackingCode(): string {
    return this.props.trackingCode;
  }

  get status(): ShipmentStatusVO {
    return this.props.status;
  }
}
