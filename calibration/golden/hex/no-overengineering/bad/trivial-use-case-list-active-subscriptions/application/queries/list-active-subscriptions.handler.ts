import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  SUBSCRIPTION_REPOSITORY_TOKEN,
  SubscriptionRepository,
} from '../../domain/repositories/subscription.repository';
import { ListActiveSubscriptionsQuery } from './list-active-subscriptions.query';
import type { SubscriptionEntity } from '../../domain/entities/subscription.entity';

@QueryHandler(ListActiveSubscriptionsQuery)
export class ListActiveSubscriptionsHandler
  implements IQueryHandler<ListActiveSubscriptionsQuery, SubscriptionEntity[]>
{
  constructor(
    @Inject(SUBSCRIPTION_REPOSITORY_TOKEN)
    private readonly repository: SubscriptionRepository.Repository,
  ) {}

  async execute(_query: ListActiveSubscriptionsQuery): Promise<SubscriptionEntity[]> {
    return this.repository.findAll();
  }
}
