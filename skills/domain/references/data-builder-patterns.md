# Data Builder Patterns

Data builders generate deterministic fake data for domain tests. They live in `domain/testing/helpers/` and are imported only by tests — never by production code.

## Purpose

- Eliminate boilerplate in test setup
- Provide sensible defaults that satisfy all domain invariants
- Support partial overrides for specific test scenarios
- Provide state-specific variants (e.g., `pendingOrderBuilder()`, `confirmedOrderBuilder()`)

---

## Pattern 1: Simple Function Builder

Use for entities without complex sub-objects or state variants.

```typescript
// domain/testing/helpers/customer.data-builder.ts
import { faker } from '@faker-js/faker';
import type { CustomerProps } from '../../entities/customer.entity';

/**
 * Returns valid CustomerProps with all invariants satisfied.
 * Pass partial overrides to customise specific fields.
 */
export function CustomerDataBuilder(
  overrides?: Partial<CustomerProps>,
): CustomerProps {
  return {
    tenantId:  overrides?.tenantId  ?? faker.string.uuid(),
    name:      overrides?.name      ?? faker.person.fullName(),
    email:     overrides?.email     ?? faker.internet.email(),
    phone:     overrides?.phone     ?? '+55 11 99999-8888',
    createdAt: overrides?.createdAt ?? new Date(),
    updatedAt: overrides?.updatedAt,
    ...overrides,
  };
}
```

Usage in tests:

```typescript
const props = CustomerDataBuilder();
const withName = CustomerDataBuilder({ name: 'Alice' });
const withTenant = CustomerDataBuilder({ tenantId: 'tenant-42' });
```

---

## Pattern 2: Builder with VO Fields

When entity props include VOs, construct them inside the builder:

```typescript
// domain/testing/helpers/order.data-builder.ts
import { faker } from '@faker-js/faker';
import type { OrderProps } from '../../entities/order.entity';
import { OrderStatusVO } from '../../value-objects/order-status.vo';

export function OrderDataBuilder(overrides?: {
  tenantId?: string;
  customerId?: string;
  totalAmount?: number;
  notes?: string;
}): Omit<OrderProps, 'status' | 'createdAt'> & { totalAmount: number } {
  return {
    tenantId:    overrides?.tenantId    ?? faker.string.uuid(),
    customerId:  overrides?.customerId  ?? faker.string.uuid(),
    totalAmount: overrides?.totalAmount ?? faker.number.int({ min: 1000, max: 100000 }),
    notes:       overrides?.notes,
  };
}

/** Pre-built entity in specific states */
export function PendingOrderBuilder(overrides?: Parameters<typeof OrderDataBuilder>[0]) {
  return OrderDataBuilder(overrides);
}

export function ConfirmedOrderBuilder(overrides?: Parameters<typeof OrderDataBuilder>[0]) {
  // Returns the props needed to build a confirmed order via entity.confirm()
  return OrderDataBuilder(overrides);
}
```

Usage:

```typescript
// Build a fresh entity
const order = OrderEntity.create(OrderDataBuilder());

// Build with specific amount
const highValueOrder = OrderEntity.create(OrderDataBuilder({ totalAmount: 500000 }));
```

---

## Pattern 3: Builder with State-Specific Variants

For entities that have meaningful lifecycle states, provide pre-built entity factories:

```typescript
// domain/testing/helpers/withdrawal-request.data-builder.ts
import { faker } from '@faker-js/faker';
import { WithdrawalRequestEntity, WithdrawalRequestProps } from '../../entities/withdrawal-request.entity';
import { WithdrawalStatusVO } from '../../value-objects/withdrawal-status.vo';
import { BankDetailsVO } from '../../value-objects/bank-details.vo';

/** Raw props builder — use for constructor/restore tests */
export function WithdrawalRequestDataBuilder(
  overrides?: Partial<WithdrawalRequestProps>,
): WithdrawalRequestProps {
  return {
    companyId:       overrides?.companyId       ?? faker.string.uuid(),
    requestedAmount: overrides?.requestedAmount ?? faker.number.int({ min: 1000, max: 100000 }),
    requestedBy:     overrides?.requestedBy     ?? faker.string.uuid(),
    status:          overrides?.status          ?? WithdrawalStatusVO.createPending(),
    bankDetails:     overrides?.bankDetails     ?? BankDetailsVO.withPixKey(faker.internet.email()),
    requestedAt:     overrides?.requestedAt     ?? new Date(),
    createdAt:       overrides?.createdAt       ?? new Date(),
    updatedAt:       overrides?.updatedAt,
  };
}

/** Entity builders for specific states */

export function buildPendingWithdrawal(
  overrides?: Partial<WithdrawalRequestProps>,
): WithdrawalRequestEntity {
  return WithdrawalRequestEntity.restore(
    { ...WithdrawalRequestDataBuilder(overrides), status: WithdrawalStatusVO.createPending() },
    faker.string.uuid(),
  );
}

export function buildApprovedWithdrawal(
  overrides?: Partial<WithdrawalRequestProps>,
): WithdrawalRequestEntity {
  return WithdrawalRequestEntity.restore(
    {
      ...WithdrawalRequestDataBuilder(overrides),
      status: WithdrawalStatusVO.createApproved(),
      reviewedBy: faker.string.uuid(),
      reviewedAt: new Date(),
    },
    faker.string.uuid(),
  );
}

export function buildCompletedWithdrawal(
  overrides?: Partial<WithdrawalRequestProps>,
): WithdrawalRequestEntity {
  return WithdrawalRequestEntity.restore(
    {
      ...WithdrawalRequestDataBuilder(overrides),
      status: WithdrawalStatusVO.createCompleted(),
      completedAt: new Date(),
    },
    faker.string.uuid(),
  );
}
```

Usage in tests:

```typescript
describe('AttachmentPermissionService', () => {
  it('should allow upload for pending request', () => {
    const request = buildPendingWithdrawal();
    expect(() => AttachmentPermissionService.assertCanUpload(request)).not.toThrow();
  });

  it('should deny upload for completed request', () => {
    const request = buildCompletedWithdrawal();
    expect(() => AttachmentPermissionService.assertCanUpload(request)).toThrow();
  });
});
```

---

## Pattern 4: Builders for Domain Event Testing

When testing that entities produce the right events, compose builders with event assertions:

```typescript
// In entity spec file
describe('OrderEntity', () => {
  describe('confirm()', () => {
    it('should queue OrderConfirmedEvent when pending', () => {
      // Arrange: build a pending order with all events cleared
      const order = OrderEntity.create(OrderDataBuilder());
      order.getUncommittedEvents().forEach((event) => order.acknowledgeEvent(event)); // discard creation events in this fixture only

      // Act
      order.confirm();

      // Assert
      const events = order.getUncommittedEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(OrderConfirmedEvent);
    });
  });
});
```

---

## Integration with In-Memory Repository

```typescript
// In use-case spec file
describe('ConfirmOrderUseCase', () => {
  let repo: InMemoryOrderRepository;

  beforeEach(() => {
    repo = new InMemoryOrderRepository();
  });

  it('should confirm a pending order', async () => {
    // Seed the repo using state-specific builder
    const order = OrderEntity.create(OrderDataBuilder({ tenantId: 'tenant-1' }));
    await repo.save(order);

    const useCase = new ConfirmOrderUseCase(repo);
    await useCase.execute({ orderId: order.id, tenantId: 'tenant-1' });

    const updated = await repo.findById(order.id);
    expect(updated?.status.isConfirmed()).toBe(true);
  });
});
```

---

## Guidelines

- Builders always produce **valid** data by default — all invariants satisfied
- Use `overrides` to test specific edge cases (empty string, boundary amount, etc.)
- Prefer `faker` for realistic data — helps catch issues with format-dependent logic
- Use `restore()` in builders that need a specific state — never call `confirm()` or `cancel()` in a builder (that would produce events)
- Export builders from `domain/testing/helpers/index.ts` for cleaner imports in tests:

```typescript
// domain/testing/helpers/index.ts
export { CustomerDataBuilder } from './customer.data-builder';
export { OrderDataBuilder, buildPendingWithdrawal, buildApprovedWithdrawal } from './order.data-builder';
```
