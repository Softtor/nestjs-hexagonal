import { Inject } from '@nestjs/common';
import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';
import {
  MEMBERSHIP_REPOSITORY_TOKEN,
  MembershipRepository,
} from '../../domain/repositories/membership.repository';
import { MembershipNotFoundError } from '../../domain/errors/membership-not-found.error';
import { CancelMembershipCommand } from './cancel-membership.command';

@CommandHandler(CancelMembershipCommand)
export class CancelMembershipHandler implements ICommandHandler<CancelMembershipCommand, void> {
  constructor(
    @Inject(MEMBERSHIP_REPOSITORY_TOKEN)
    private readonly repository: MembershipRepository.Repository,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: CancelMembershipCommand): Promise<void> {
    const membership = await this.repository.findById(command.membershipId);

    if (!membership || membership.organizationId !== command.organizationId) {
      throw new MembershipNotFoundError(command.membershipId);
    }

    const tracked = this.publisher.mergeObjectContext(membership);
    tracked.cancel(command.reason);
    await this.repository.save(tracked);
    tracked.commit();
  }
}
