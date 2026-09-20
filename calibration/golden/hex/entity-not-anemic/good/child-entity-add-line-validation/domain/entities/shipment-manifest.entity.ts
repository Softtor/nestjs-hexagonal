import { Entity } from '@/shared/base-classes/entity';
import { InvalidManifestLineError } from '../errors/invalid-manifest-line.error';

export interface ManifestLine {
  sku: string;
  quantity: number;
  weightKg: number;
}

export interface ShipmentManifestProps {
  shipmentId: string;
  lines: ManifestLine[];
  maxWeightKg: number;
}

export class ShipmentManifestEntity extends Entity<ShipmentManifestProps> {
  private constructor(props: ShipmentManifestProps, id?: string) {
    super(props, id);
  }

  static restore(props: ShipmentManifestProps, id: string): ShipmentManifestEntity {
    return new ShipmentManifestEntity(props, id);
  }

  addLine(line: ManifestLine): void {
    if (line.quantity <= 0) {
      throw new InvalidManifestLineError(line.sku, 'quantity must be greater than zero');
    }

    const currentWeight = this.props.lines.reduce((sum, existing) => sum + existing.weightKg, 0);
    if (currentWeight + line.weightKg > this.props.maxWeightKg) {
      throw new InvalidManifestLineError(line.sku, 'exceeds manifest weight capacity');
    }

    this.props.lines.push(line);
  }

  get shipmentId(): string {
    return this.props.shipmentId;
  }

  get lines(): ManifestLine[] {
    return [...this.props.lines];
  }

  get maxWeightKg(): number {
    return this.props.maxWeightKg;
  }
}
