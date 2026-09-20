import { Entity } from '@/shared/base-classes/entity';

export interface TicketProps {
  organizationId: string;
  requesterId: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  escalated: boolean;
  escalatedAt?: Date;
  reopenedCount: number;
}

export class TicketEntity extends Entity<TicketProps> {
  private constructor(props: TicketProps, id?: string) {
    super(props, id);
  }

  static restore(props: TicketProps, id: string): TicketEntity {
    return new TicketEntity(props, id);
  }

  escalate(): void {
    if (this.props.priority !== 'high' && this.props.priority !== 'urgent') {
      return;
    }

    this.props.escalated = true;
    this.props.escalatedAt = new Date();
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get requesterId(): string {
    return this.props.requesterId;
  }

  get priority(): string {
    return this.props.priority;
  }

  get escalated(): boolean {
    return this.props.escalated;
  }

  get reopenedCount(): number {
    return this.props.reopenedCount;
  }
}
