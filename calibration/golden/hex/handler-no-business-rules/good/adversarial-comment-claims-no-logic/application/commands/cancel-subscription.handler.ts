import { Inject } from '@nestjs/common';
import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';
import {
  SUBSCRIPTION_REPOSITORY_TOKEN,
  SubscriptionRepository,
} from '../../domain/repositories/subscription.repository';
import { SubscriptionNotFoundError } from '../../domain/errors/subscription-not-found.error';
import { CancelSubscriptionCommand } from './cancel-subscription.command';

@CommandHandler(CancelSubscriptionCommand)
export class CancelSubscriptionHandler
  implements ICommandHandler<CancelSubscriptionCommand, void>
{
  constructor(
    @Inject(SUBSCRIPTION_REPOSITORY_TOKEN)
    private readonly repository: SubscriptionRepository.Repository,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: CancelSubscriptionCommand): Promise<void> {
    const subscription = await this.repository.findById(command.subscriptionId);

    if (!subscription || subscription.organizationId !== command.organizationId) {
      throw new SubscriptionNotFoundError(command.subscriptionId);
    }

    // this is not business logic, just calling the aggregate
    subscription.cancel(command.reason);

    this.publisher.mergeObjectContext(subscription);
    await this.repository.save(subscription);
    subscription.commit();
  }
}
