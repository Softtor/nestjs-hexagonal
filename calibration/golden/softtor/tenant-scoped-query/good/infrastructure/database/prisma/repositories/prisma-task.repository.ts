import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/shared/infrastructure/prisma/prisma.service';

@Injectable()
export class PrismaTaskRepository {
  private readonly cache = new Map<string, unknown>();

  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string, organizationId: string): Promise<unknown | null> {
    return this.prisma.task.findUnique({ where: { id, organizationId } });
  }

  async listOpen(organizationId: string): Promise<unknown[]> {
    const where = { organizationId, status: 'OPEN' };
    return this.prisma.task.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  async insert(data: { organizationId: string; title: string }): Promise<void> {
    await this.prisma.task.create({ data });
  }

  forget(id: string): void {
    this.cache.delete(id);
  }
}
