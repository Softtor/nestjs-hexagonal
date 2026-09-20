import { Entity } from '@/shared/base-classes/entity';

interface CustomerProps {
  name: string;
}

export class CustomerEntity extends Entity<CustomerProps> {
  private constructor(props: CustomerProps, id?: string) {
    super(props, id);
  }

  static create(props: CustomerProps): CustomerEntity {
    return new CustomerEntity(props);
  }
}
