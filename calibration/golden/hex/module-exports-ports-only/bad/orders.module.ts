import { Module } from '@nestjs/common';
import { CreateOrderUseCase } from '../application/usecases/create-order.usecase';

@Module({
  providers: [CreateOrderUseCase],
  exports: [CreateOrderUseCase],
})
export class OrdersModule {}
