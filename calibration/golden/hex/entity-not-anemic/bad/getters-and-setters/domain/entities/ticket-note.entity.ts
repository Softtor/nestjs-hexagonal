import { Entity } from '@/shared/base-classes/entity';

export interface TicketNoteProps {
  ticketId: string;
  authorId: string;
  body: string;
  visibility: 'internal' | 'public';
  pinned: boolean;
}

export class TicketNoteEntity extends Entity<TicketNoteProps> {
  private constructor(props: TicketNoteProps, id?: string) {
    super(props, id);
  }

  static restore(props: TicketNoteProps, id: string): TicketNoteEntity {
    return new TicketNoteEntity(props, id);
  }

  get ticketId(): string {
    return this.props.ticketId;
  }

  get authorId(): string {
    return this.props.authorId;
  }

  get body(): string {
    return this.props.body;
  }

  set body(value: string) {
    this.props.body = value;
  }

  get visibility(): string {
    return this.props.visibility;
  }

  set visibility(value: 'internal' | 'public') {
    this.props.visibility = value;
  }

  get pinned(): boolean {
    return this.props.pinned;
  }

  set pinned(value: boolean) {
    this.props.pinned = value;
  }
}
