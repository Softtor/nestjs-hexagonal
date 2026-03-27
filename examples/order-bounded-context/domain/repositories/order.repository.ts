import type { OrderEntity } from '../entities/order.entity';
import type { OrderStatusEnum } from '../value-objects/order-status.vo';
import {
  SearchParams as DefaultSearchParams,
  SearchResult as DefaultSearchResult,
  SearchableRepositoryInterface,
} from '@/shared/repository-contracts/searchable-repository';

export namespace OrderRepository {
  export type Filter = string;

  export interface OrderSearchFilter {
    organizationId: string;
    status?: OrderStatusEnum;
    customerId?: string;
    dateRange?: {
      from: Date;
      to: Date;
    };
  }

  export class SearchParams extends DefaultSearchParams<OrderSearchFilter> {}
  export class SearchResult extends DefaultSearchResult<OrderEntity, OrderSearchFilter> {}

  export interface Repository
    extends SearchableRepositoryInterface<
      OrderEntity,
      OrderSearchFilter,
      SearchParams,
      SearchResult
    > {
    findById(id: string): Promise<OrderEntity | null>;
    findByOrganization(organizationId: string): Promise<OrderEntity[]>;
    save(entity: OrderEntity): Promise<void>;
    delete(id: string): Promise<void>;
  }
}

export const ORDER_REPOSITORY_TOKEN = Symbol('OrderRepository');
