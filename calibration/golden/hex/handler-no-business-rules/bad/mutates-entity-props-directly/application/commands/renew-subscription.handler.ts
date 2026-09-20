import { Inject } from '@nestjs/common';
import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';
import {
  SUBSCRIPTION_REPOSITORY_TOKEN,
  SubscriptionRepository,
} from '../../domain/repositories/subscription.repository';
import { SubscriptionNotFoundError } from '../../domain/errors/subscription-not-found.error';
import { RenewSubscriptionCommand } from './renew-subscription.command';

@CommandHandler(RenewSubscriptionCommand)
export class RenewSubscriptionHandler
  implements ICommandHandler<RenewSubscriptionCommand, void>
{
  constructor(
    @Inject(SUBSCRIPTION_REPOSITORY_TOKEN)
    private readonly repository: SubscriptionRepository.Repository,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: RenewSubscriptionCommand): Promise<void> {
    const subscription = await this.repository.findById(command.subscriptionId);

    if (!subscription || subscription.organizationId !== command.organizationId) {
      throw new SubscriptionNotFoundError(command.subscriptionId);
    }

    const nextPeriodEnd = new Date(subscription.props.currentPeriodEnd);
    nextPeriodEnd.setMonth(nextPeriodEnd.getMonth() + 1);

    subscription.props.currentPeriodEnd = nextPeriodEnd;
    subscription.props.status = 'active';

    this.publisher.mergeObjectContext(subscription);
    await this.repository.save(subscription);
    subscription.commit();
  }
}
