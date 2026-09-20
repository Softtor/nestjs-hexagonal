import { Entity } from '@/shared/base-classes/entity';
import { SubscriptionRenewedEvent } from '../events/subscription-renewed.event';

export interface SubscriptionProps {
  organizationId: string;
  planId: string;
  customerId: string;
  cyclesRenewed: number;
  renewedAt?: Date;
  expiresAt: Date;
}

export class SubscriptionEntity extends Entity<SubscriptionProps> {
  private constructor(props: SubscriptionProps, id?: string) {
    super(props, id);
  }

  static restore(props: SubscriptionProps, id: string): SubscriptionEntity {
    return new SubscriptionEntity(props, id);
  }

  renew(nextExpiresAt: Date): void {
    this.props.cyclesRenewed = this.props.cyclesRenewed + 1;
    this.props.renewedAt = new Date();
    this.props.expiresAt = nextExpiresAt;

    this.apply(
      new SubscriptionRenewedEvent(this.id, this.props.organizationId, this.props.cyclesRenewed),
    );
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get planId(): string {
    return this.props.planId;
  }

  get customerId(): string {
    return this.props.customerId;
  }

  get cyclesRenewed(): number {
    return this.props.cyclesRenewed;
  }

  get expiresAt(): Date {
    return this.props.expiresAt;
  }
}
