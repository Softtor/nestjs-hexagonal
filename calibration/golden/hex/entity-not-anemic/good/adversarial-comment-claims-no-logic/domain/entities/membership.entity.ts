import { Entity } from '@/shared/base-classes/entity';
import { MembershipAlreadyCancelledError } from '../errors/membership-already-cancelled.error';

export interface MembershipProps {
  organizationId: string;
  memberId: string;
  tier: 'basic' | 'plus' | 'elite';
  active: boolean;
  cancelledAt?: Date;
}

export class MembershipEntity extends Entity<MembershipProps> {
  private constructor(props: MembershipProps, id?: string) {
    super(props, id);
  }

  static restore(props: MembershipProps, id: string): MembershipEntity {
    return new MembershipEntity(props, id);
  }

  // this is not business logic, just a flag flip
  cancel(): void {
    if (!this.props.active) {
      throw new MembershipAlreadyCancelledError(this.id);
    }

    this.props.active = false;
    this.props.cancelledAt = new Date();
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get memberId(): string {
    return this.props.memberId;
  }

  get tier(): string {
    return this.props.tier;
  }

  get active(): boolean {
    return this.props.active;
  }
}
