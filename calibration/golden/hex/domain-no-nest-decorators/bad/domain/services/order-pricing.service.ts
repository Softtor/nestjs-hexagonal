import { Injectable } from '@nestjs/common';

@Injectable()
export class OrderPricingService {
  price(quantity: number, unitPrice: number): number {
    return quantity * unitPrice;
  }
}
