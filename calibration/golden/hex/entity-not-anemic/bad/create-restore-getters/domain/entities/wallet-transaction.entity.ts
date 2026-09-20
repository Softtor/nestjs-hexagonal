import { Entity } from '@/shared/base-classes/entity';

export interface WalletTransactionProps {
  walletId: string;
  amountCents: number;
  direction: 'credit' | 'debit';
  createdAt: Date;
}

export class WalletTransactionEntity extends Entity<WalletTransactionProps> {
  private constructor(props: WalletTransactionProps, id?: string) {
    super(props, id);
  }

  static create(props: Omit<WalletTransactionProps, 'createdAt'>, id?: string): WalletTransactionEntity {
    return new WalletTransactionEntity({ ...props, createdAt: new Date() }, id);
  }

  static restore(props: WalletTransactionProps, id: string): WalletTransactionEntity {
    return new WalletTransactionEntity(props, id);
  }

  get walletId(): string {
    return this.props.walletId;
  }

  get amountCents(): number {
    return this.props.amountCents;
  }

  get direction(): string {
    return this.props.direction;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }
}
