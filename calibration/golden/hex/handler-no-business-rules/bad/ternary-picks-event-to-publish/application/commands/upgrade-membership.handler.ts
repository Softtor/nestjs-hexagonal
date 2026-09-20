import { Inject } from '@nestjs/common';
import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';
import {
  MEMBERSHIP_REPOSITORY_TOKEN,
  MembershipRepository,
} from '../../domain/repositories/membership.repository';
import { MembershipNotFoundError } from '../../domain/errors/membership-not-found.error';
import { MembershipUpgradedEvent } from '../../domain/events/membership-upgraded.event';
import { MembershipDowngradedEvent } from '../../domain/events/membership-downgraded.event';
import { ChangeMembershipTierCommand } from './change-membership-tier.command';

@CommandHandler(ChangeMembershipTierCommand)
export class ChangeMembershipTierHandler
  implements ICommandHandler<ChangeMembershipTierCommand, void>
{
  constructor(
    @Inject(MEMBERSHIP_REPOSITORY_TOKEN)
    private readonly repository: MembershipRepository.Repository,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: ChangeMembershipTierCommand): Promise<void> {
    const membership = await this.repository.findById(command.membershipId);

    if (!membership || membership.organizationId !== command.organizationId) {
      throw new MembershipNotFoundError(command.membershipId);
    }

    membership.changeTier(command.newTierRank);

    const publisherContext = this.publisher.mergeObjectContext(membership);
    await this.repository.save(membership);

    const event =
      command.newTierRank > membership.previousTierRank
        ? new MembershipUpgradedEvent(membership.id, command.newTierRank)
        : new MembershipDowngradedEvent(membership.id, command.newTierRank);

    publisherContext.apply(event);
    membership.commit();
  }
}
