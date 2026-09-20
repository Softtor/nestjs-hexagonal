import { Module } from '@nestjs/common';
import { ORDER_REPOSITORY_TOKEN } from '../domain/repositories/order.repository';
import { PrismaOrderRepository } from './database/prisma/repositories/prisma-order.repository';

@Module({
  providers: [PrismaOrderRepository, { provide: ORDER_REPOSITORY_TOKEN, useExisting: PrismaOrderRepository }],
  exports: [ORDER_REPOSITORY_TOKEN],
})
export class OrdersModule {}
