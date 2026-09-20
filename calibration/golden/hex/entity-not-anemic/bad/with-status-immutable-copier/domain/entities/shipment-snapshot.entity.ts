import { Entity } from '@/shared/base-classes/entity';

export interface ShipmentSnapshotProps {
  organizationId: string;
  orderId: string;
  status: 'pending' | 'in_transit' | 'delivered' | 'cancelled';
  carrier: string;
}

export class ShipmentSnapshotEntity extends Entity<ShipmentSnapshotProps> {
  private constructor(props: ShipmentSnapshotProps, id?: string) {
    super(props, id);
  }

  static restore(props: ShipmentSnapshotProps, id: string): ShipmentSnapshotEntity {
    return new ShipmentSnapshotEntity(props, id);
  }

  withStatus(status: ShipmentSnapshotProps['status']): ShipmentSnapshotEntity {
    return new ShipmentSnapshotEntity({ ...this.props, status }, this.id);
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get orderId(): string {
    return this.props.orderId;
  }

  get status(): string {
    return this.props.status;
  }

  get carrier(): string {
    return this.props.carrier;
  }
}
