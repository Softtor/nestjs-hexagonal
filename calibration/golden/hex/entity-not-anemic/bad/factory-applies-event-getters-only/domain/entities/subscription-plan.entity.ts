import { Entity } from '@/shared/base-classes/entity';
import { SubscriptionPlanCreatedEvent } from '../events/subscription-plan-created.event';

export interface SubscriptionPlanProps {
  organizationId: string;
  name: string;
  priceCents: number;
  billingCycle: 'monthly' | 'yearly';
  createdAt: Date;
}

export class SubscriptionPlanEntity extends Entity<SubscriptionPlanProps> {
  private constructor(props: SubscriptionPlanProps, id?: string) {
    super(props, id);
  }

  static create(
    input: Omit<SubscriptionPlanProps, 'createdAt'>,
    id?: string,
  ): SubscriptionPlanEntity {
    const entity = new SubscriptionPlanEntity({ ...input, createdAt: new Date() }, id);
    entity.apply(new SubscriptionPlanCreatedEvent(entity.id, input.organizationId, input.name));
    return entity;
  }

  static restore(props: SubscriptionPlanProps, id: string): SubscriptionPlanEntity {
    return new SubscriptionPlanEntity(props, id);
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get name(): string {
    return this.props.name;
  }

  get priceCents(): number {
    return this.props.priceCents;
  }

  get billingCycle(): string {
    return this.props.billingCycle;
  }
}
