import { Entity } from '@/shared/base-classes/entity';
import { InsufficientFundsError } from '../errors/insufficient-funds.error';

export interface WalletProps {
  organizationId: string;
  ownerId: string;
  balanceCents: number;
  currency: string;
}

export class WalletEntity extends Entity<WalletProps> {
  private constructor(props: WalletProps, id?: string) {
    super(props, id);
  }

  static restore(props: WalletProps, id: string): WalletEntity {
    return new WalletEntity(props, id);
  }

  withdraw(amountCents: number): void {
    if (amountCents > this.props.balanceCents) {
      throw new InsufficientFundsError(this.id, amountCents, this.props.balanceCents);
    }

    this.props.balanceCents = this.props.balanceCents - amountCents;
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get ownerId(): string {
    return this.props.ownerId;
  }

  get balanceCents(): number {
    return this.props.balanceCents;
  }

  get currency(): string {
    return this.props.currency;
  }
}
