import { Entity } from '@/shared/base-classes/entity';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

interface OrderProps {
  total: number;
}

export class OrderEntity extends Entity<OrderProps> {
  constructor(props: OrderProps, private readonly prisma: PrismaService) {
    super(props);
  }
}
