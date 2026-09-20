import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/shared/infrastructure/prisma/prisma.service';

@Injectable()
export class PrismaOrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<unknown[]> {
    return this.prisma.order.findMany();
  }

  async delete(id: string): Promise<void> {
    await this.prisma.order.delete({ where: { id } });
  }
}
