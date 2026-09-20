import type { OrderEntity } from '../entities/order.entity';
import { SearchParams as DefaultSearchParams } from '@/shared/repository-contracts/searchable-repository';

export namespace OrderRepository {
  export class SearchParams extends DefaultSearchParams<{ organizationId: string }> {}

  export interface Repository {
    findById(id: string): Promise<OrderEntity | null>;
    save(entity: OrderEntity): Promise<void>;
  }
}

export const ORDER_REPOSITORY_TOKEN = Symbol('OrderRepository');
