import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/shared/infrastructure/prisma/prisma.service';
import { OrderEntity } from '../../../../domain/entities/order.entity';
import {
  OrderRepository,
} from '../../../../domain/repositories/order.repository';
import { OrderNotFoundError } from '../../../../domain/errors/order-not-found.error';
import { OrderModelMapper } from './order-model.mapper';
import {
  SearchResult,
} from '@/shared/repository-contracts/searchable-repository';

/**
 * PURE persistence — no events, no business logic.
 * All it does is map entities to/from the database.
 */
@Injectable()
export class PrismaOrderRepository implements OrderRepository.Repository {
  sortableFields = ['createdAt', 'status', 'total'];

  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<OrderEntity | null> {
    const row = await this.prisma.order.findUnique({ where: { id } });
    return row ? OrderModelMapper.toEntity(row) : null;
  }

  async findByOrganization(organizationId: string): Promise<OrderEntity[]> {
    const rows = await this.prisma.order.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(OrderModelMapper.toEntity);
  }

  async save(entity: OrderEntity): Promise<void> {
    const data = OrderModelMapper.toModel(entity);
    await this.prisma.order.upsert({
      where: { id: entity.id },
      create: data,
      update: data,
    });
  }

  async delete(id: string): Promise<void> {
    const exists = await this.prisma.order.findUnique({ where: { id } });
    if (!exists) throw new OrderNotFoundError(id);
    await this.prisma.order.delete({ where: { id } });
  }

  async insert(entity: OrderEntity): Promise<void> {
    const data = OrderModelMapper.toModel(entity);
    await this.prisma.order.create({ data });
  }

  async findAll(): Promise<OrderEntity[]> {
    const rows = await this.prisma.order.findMany();
    return rows.map(OrderModelMapper.toEntity);
  }

  async update(entity: OrderEntity): Promise<void> {
    const data = OrderModelMapper.toModel(entity);
    await this.prisma.order.update({ where: { id: entity.id }, data });
  }

  async search(
    params: OrderRepository.SearchParams,
  ): Promise<OrderRepository.SearchResult> {
    const filter = params.filter ?? { organizationId: '' };
    const skip = (params.page - 1) * params.perPage;

    const where = {
      organizationId: filter.organizationId,
      ...(filter.status && { status: filter.status }),
      ...(filter.customerId && { customerId: filter.customerId }),
      ...(filter.dateRange && {
        createdAt: { gte: filter.dateRange.from, lte: filter.dateRange.to },
      }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take: params.perPage,
        orderBy: params.sort
          ? { [params.sort]: params.sortDir ?? 'desc' }
          : { createdAt: 'desc' },
      }),
      this.prisma.order.count({ where }),
    ]);

    return new SearchResult({
      items: rows.map(OrderModelMapper.toEntity),
      total,
      currentPage: params.page,
      perPage: params.perPage,
      sort: params.sort,
      sortDir: params.sortDir,
      filter: filter,
    });
  }
}
