export abstract class OrderRepository {
  abstract findById(id: string): Promise<null>;
}
