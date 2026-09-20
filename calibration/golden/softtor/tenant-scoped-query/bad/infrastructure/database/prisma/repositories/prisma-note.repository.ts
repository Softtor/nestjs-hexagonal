import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/shared/infrastructure/prisma/prisma.service';

@Injectable()
export class PrismaNoteRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listByOrganization(organizationId: string): Promise<unknown[]> {
    const where = { organizationId };
    return this.prisma.note.findMany({ where });
  }

  async findById(id: string): Promise<unknown | null> {
    return this.prisma.note.findUnique({ where: { id } });
  }
}
