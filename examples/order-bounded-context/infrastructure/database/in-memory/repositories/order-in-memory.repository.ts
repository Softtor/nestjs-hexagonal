import { OrderEntity } from '../../../../domain/entities/order.entity';
import {
  OrderRepository,
} from '../../../../domain/repositories/order.repository';
import { OrderNotFoundError } from '../../../../domain/errors/order-not-found.error';
import {
  SearchResult,
} from '@/shared/repository-contracts/searchable-repository';

/**
 * In-memory repository for use in unit tests.
 * Holds entities in a Map — no database needed.
 */
export class OrderInMemoryRepository implements OrderRepository.Repository {
  sortableFields = ['createdAt', 'status'];

  private readonly store = new Map<string, OrderEntity>();

  async findById(id: string): Promise<OrderEntity | null> {
    return this.store.get(id) ?? null;
  }

  async findByOrganization(organizationId: string): Promise<OrderEntity[]> {
    return [...this.store.values()].filter(
      (o) => o.organizationId === organizationId,
    );
  }

  async save(entity: OrderEntity): Promise<void> {
    this.store.set(entity.id, entity);
  }

  async delete(id: string): Promise<void> {
    if (!this.store.has(id)) throw new OrderNotFoundError(id);
    this.store.delete(id);
  }

  async insert(entity: OrderEntity): Promise<void> {
    this.store.set(entity.id, entity);
  }

  async findAll(): Promise<OrderEntity[]> {
    return [...this.store.values()];
  }

  async update(entity: OrderEntity): Promise<void> {
    this.store.set(entity.id, entity);
  }

  async search(
    params: OrderRepository.SearchParams,
  ): Promise<OrderRepository.SearchResult> {
    const filter = params.filter ?? { organizationId: '' };

    let items = [...this.store.values()].filter(
      (o) => o.organizationId === filter.organizationId,
    );

    if (filter.status) {
      items = items.filter((o) => o.status.value === filter.status);
    }

    if (filter.customerId) {
      items = items.filter((o) => o.customerId === filter.customerId);
    }

    if (filter.dateRange) {
      items = items.filter(
        (o) =>
          o.createdAt >= filter.dateRange!.from &&
          o.createdAt <= filter.dateRange!.to,
      );
    }

    const total = items.length;
    const start = (params.page - 1) * params.perPage;
    const paginated = items.slice(start, start + params.perPage);

    return new SearchResult({
      items: paginated,
      total,
      currentPage: params.page,
      perPage: params.perPage,
      sort: params.sort,
      sortDir: params.sortDir,
      filter,
    });
  }

  // Test helper: check how many orders are stored
  get count(): number {
    return this.store.size;
  }

  // Test helper: reset store between test cases
  clear(): void {
    this.store.clear();
  }
}
