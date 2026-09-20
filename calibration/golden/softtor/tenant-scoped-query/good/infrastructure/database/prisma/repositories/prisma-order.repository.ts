import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/shared/infrastructure/prisma/prisma.service';

@Injectable()
export class PrismaOrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByOrganization(organizationId: string): Promise<unknown[]> {
    return this.prisma.order.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } });
  }

  async delete(id: string, organizationId: string): Promise<void> {
    await this.prisma.order.delete({ where: { id, organizationId } });
  }

  async rename(id: string, organizationId: string, title: string): Promise<void> {
    await this.prisma.order.update({
      where: { id, organizationId },
      data: { title },
    });
  }
}
