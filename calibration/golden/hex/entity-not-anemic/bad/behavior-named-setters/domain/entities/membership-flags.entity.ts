import { Entity } from '@/shared/base-classes/entity';

export interface MembershipFlagsProps {
  organizationId: string;
  memberId: string;
  active: boolean;
  suspended: boolean;
  activatedAt?: Date;
  suspendedAt?: Date;
}

export class MembershipFlagsEntity extends Entity<MembershipFlagsProps> {
  private constructor(props: MembershipFlagsProps, id?: string) {
    super(props, id);
  }

  static restore(props: MembershipFlagsProps, id: string): MembershipFlagsEntity {
    return new MembershipFlagsEntity(props, id);
  }

  activate(): void {
    this.props.active = true;
    this.props.activatedAt = new Date();
  }

  suspend(): void {
    this.props.suspended = true;
    this.props.suspendedAt = new Date();
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get memberId(): string {
    return this.props.memberId;
  }

  get active(): boolean {
    return this.props.active;
  }

  get suspended(): boolean {
    return this.props.suspended;
  }
}
