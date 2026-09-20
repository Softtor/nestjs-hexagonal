import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/shared/infrastructure/prisma/prisma.service';

@Injectable()
export class PrismaTaskRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<unknown | null> {
    return this.prisma.task.findUnique({ where: { id } });
  }

  async insert(data: { organizationId: string; title: string }): Promise<void> {
    await this.prisma.task.create({ data });
  }
}
