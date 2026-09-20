import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/shared/infrastructure/prisma/prisma.service';

@Injectable()
export class PrismaTaskRepository {
  constructor(private readonly prisma: PrismaService) {}

  async rename(id: string, title: string): Promise<void> {
    await this.prisma.task.update({
      where: { id },
      data: { title },
    });
  }
}
