export namespace CreateOrderDto {
  export interface ItemInput {
    productId: string;
    name: string;
    quantity: number;
    unitPrice: number;
  }

  export interface Input {
    organizationId: string;
    customerId: string;
    customerName: string;
    items: ItemInput[];
    currency: string;
    notes?: string;
  }

  export interface Output {
    id: string;
  }
}
