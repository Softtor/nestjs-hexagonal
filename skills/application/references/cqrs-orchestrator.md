# Pattern C — Handler as Orchestrator

Use when a command handler must coordinate multiple services (QueryBus lookups,
external port calls, complex enrichment) before delegating core business logic
to a pure, framework-agnostic UseCase.

The key contract:
- **UseCase** is framework-agnostic: no `@Injectable`, no `@Inject`, no `@nestjs/cqrs`.
  It receives dependencies through its constructor and **returns the entity**.
- **Handler** owns all NestJS DI wiring, orchestrates cross-cutting concerns,
  and is the sole owner of `EventDispatcher` + `await events.from(entity).publish()`.

---

## When to choose Pattern C over Pattern B

Choose Pattern C when:
- The handler needs to call `QueryBus` to resolve external data before the use case runs.
- The handler interacts with 2+ ports (e.g., customer resolution, config lookup, notification).
- The same business logic (UseCase) might be reused from CLI, jobs, or other handlers.
- The UseCase is complex enough to warrant its own isolated unit test without NestJS.

Choose Pattern B when:
- The handler logic is straightforward and contained.
- No complex pre-orchestration is needed.
- The logic will not be reused outside this handler.

---

## Directory layout

```
application/
├── dtos/
│   └── create-charge.dto.ts
├── usecases/
│   └── create-charge.usecase.ts        # framework-agnostic, returns entity
└── commands/
    ├── create-charge.command.ts
    └── create-charge.handler.ts        # orchestrator + EventDispatcher
```

---

## Command

```typescript
// application/commands/create-charge.command.ts
import { Command } from '@nestjs/cqrs';
import type { CreateChargeDtoOutput } from '../dtos/create-charge.dto';

export class CreateChargeCommand extends Command<CreateChargeDtoOutput> {
  constructor(
    public readonly companyId: string,
    public readonly customerId: string,
    public readonly paymentMethod: string,
    public readonly items: Array<{ productId: string; quantity: number }>,
  ) {
    super();
  }
}
```

---

## UseCase (framework-agnostic)

The UseCase has **no NestJS imports**. Shared entity and event bases are pure TypeScript. It **returns the entity** so the
handler can call `events.from(entity).publish()`.

```typescript
// application/usecases/create-charge.usecase.ts
import type { TransactionRepository } from '../../domain/repositories/transaction.repository';
import type { LoggerPort } from '../../application/ports/logger.port';
import { TransactionEntity } from '../../domain/entities/transaction.entity';
import { FeeBreakdownVO } from '../../domain/value-objects/fee-breakdown.vo';

export interface CreateChargeInput {
  companyId: string;
  resolvedCustomerId?: string;
  paymentMethod: string;
  items: Array<{ productId: string; quantity: number }>;
  feeConfig: { percentage: number; fixed: number };
  acquirerConfig: { id: string; name: string };
}

export namespace CreateChargeUseCase {
  export interface Input extends CreateChargeInput {}

  export class UseCase {
    constructor(
      private readonly repository: TransactionRepository.Repository,
      private readonly logger: LoggerPort,
    ) {}

    // Returns the entity — handler handles events.from(entity).publish()
    async execute(input: Input): Promise<TransactionEntity> {
      const fee = FeeBreakdownVO.fromConfig(input.items, input.feeConfig);

      const entity = TransactionEntity.create({
        companyId: input.companyId,
        customerId: input.resolvedCustomerId,
        paymentMethod: input.paymentMethod,
        items: input.items,
        feeBreakdown: fee,
        acquirerId: input.acquirerConfig.id,
      });

      await this.repository.insert(entity);

      this.logger.log('Transaction created', {
        transactionId: entity.id,
        companyId: input.companyId,
      });

      return entity; // <-- return entity, NOT { id: entity.id }
    }
  }
}
```

---

## Handler (Orchestrator)

The handler wires NestJS dependencies, orchestrates pre-conditions, delegates to
the use case, then handles event publication.

```typescript
// application/commands/create-charge.handler.ts
import { Inject, Logger } from '@nestjs/common';
import { CommandBus, CommandHandler, ICommandHandler, QueryBus } from '@nestjs/cqrs';
import { EVENT_DISPATCHER_TOKEN } from '@/shared/events/event-publisher.port';
import { EventDispatcher } from '@/shared/events/event-dispatcher';

import type { TransactionRepository } from '../../domain/repositories/transaction.repository';
import { TRANSACTION_REPOSITORY_TOKEN } from '../../domain/repositories/transaction.repository';
import type { CustomerPort } from '../ports/customer.port';
import { CUSTOMER_PORT_TOKEN } from '../ports/customer.port';
import type { LoggerPort } from '../ports/logger.port';
import { LOGGER_PORT_TOKEN } from '../ports/logger.port';
import { ResolveAcquirerConfigQuery } from '../queries/resolve-acquirer-config.query';
import { CreateChargeCommand } from './create-charge.command';
import { CreateChargeUseCase } from '../usecases/create-charge.usecase';

@CommandHandler(CreateChargeCommand)
export class CreateChargeHandler
  implements ICommandHandler<CreateChargeCommand, { id: string }>
{
  private readonly logger = new Logger(CreateChargeHandler.name);
  private readonly useCase: CreateChargeUseCase.UseCase;

  constructor(
    private readonly queryBus: QueryBus,
    @Inject(TRANSACTION_REPOSITORY_TOKEN)
    transactionRepository: TransactionRepository.Repository,
    @Inject(CUSTOMER_PORT_TOKEN)
    private readonly customerPort: CustomerPort,
    @Inject(LOGGER_PORT_TOKEN)
    logger: LoggerPort,
    @Inject(EVENT_DISPATCHER_TOKEN) private readonly events: EventDispatcher,
  ) {
    // Instantiate the framework-agnostic use case, passing its dependencies
    this.useCase = new CreateChargeUseCase.UseCase(transactionRepository, logger);
  }

  async execute(command: CreateChargeCommand): Promise<{ id: string }> {
    // 1. Orchestrate: resolve external data via QueryBus and ports
    const acquirerConfig = await this.queryBus.execute(
      new ResolveAcquirerConfigQuery(command.companyId, command.paymentMethod),
    );

    if (!acquirerConfig.supports(command.paymentMethod)) {
      throw new Error(`Payment method ${command.paymentMethod} not supported`);
    }

    const resolvedCustomerId = command.customerId
      ? await this.resolveCustomer(command.customerId, command.companyId)
      : undefined;

    const feeConfig = acquirerConfig.getFeeConfig(command.paymentMethod);

    // 2. Delegate business logic to framework-agnostic use case
    //    UseCase returns entity so handler can publish events
    const entity = await this.useCase.execute({
      companyId: command.companyId,
      resolvedCustomerId,
      paymentMethod: command.paymentMethod,
      items: command.items,
      feeConfig,
      acquirerConfig,
    });

    // 3. Handler owns event publication — NEVER inside the use case
    await this.events.from(entity).publish(); // after persistence / actual transaction commit

    this.logger.log(`CreateChargeCommand processed: ${entity.id}`);
    return { id: entity.id };
  }

  private async resolveCustomer(
    customerId: string,
    companyId: string,
  ): Promise<string | undefined> {
    const customer = await this.customerPort.findById(customerId);
    if (!customer || customer.companyId !== companyId) {
      return undefined;
    }
    return customer.id;
  }
}
```

---

## Module Registration

```typescript
// infrastructure/payments.module.ts
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { TRANSACTION_REPOSITORY_TOKEN } from '../domain/repositories/transaction.repository';
import { CUSTOMER_PORT_TOKEN } from '../application/ports/customer.port';
import { LOGGER_PORT_TOKEN } from '../application/ports/logger.port';
import { CreateChargeHandler } from '../application/commands/create-charge.handler';
import { ResolveAcquirerConfigHandler } from '../application/queries/resolve-acquirer-config.handler';
import { PaymentsController } from './controllers/payments.controller';
import { PrismaTransactionRepository } from './repositories/prisma-transaction.repository';
import { CustomerPortAdapter } from './adapters/customer-port.adapter';
import { PinoLoggerAdapter } from '@/shared/infrastructure/logger/pino-logger.adapter';

@Module({
  imports: [CqrsModule],
  controllers: [PaymentsController],
  providers: [
    PrismaTransactionRepository,
    {
      provide: TRANSACTION_REPOSITORY_TOKEN,
      useExisting: PrismaTransactionRepository,
    },
    CustomerPortAdapter,
    {
      provide: CUSTOMER_PORT_TOKEN,
      useExisting: CustomerPortAdapter,
    },
    {
      provide: LOGGER_PORT_TOKEN,
      useExisting: PinoLoggerAdapter,
    },
    CreateChargeHandler,
    ResolveAcquirerConfigHandler,
  ],
  exports: [TRANSACTION_REPOSITORY_TOKEN],
})
export class PaymentsModule {}
```

---

## Unit Tests

### UseCase test (no NestJS)

```typescript
// application/usecases/__tests__/create-charge.usecase.spec.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateChargeUseCase } from '../create-charge.usecase';

const mockRepository = { insert: vi.fn(), update: vi.fn() };
const mockLogger = { log: vi.fn(), error: vi.fn(), debug: vi.fn() };

describe('CreateChargeUseCase', () => {
  let useCase: CreateChargeUseCase.UseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    useCase = new CreateChargeUseCase.UseCase(mockRepository as any, mockLogger as any);
  });

  it('creates and persists a transaction entity', async () => {
    const entity = await useCase.execute({
      companyId: 'company-1',
      paymentMethod: 'pix',
      items: [{ productId: 'prod-1', quantity: 1 }],
      feeConfig: { percentage: 2, fixed: 0 },
      acquirerConfig: { id: 'acq-1', name: 'Acquirer A' },
    });

    expect(mockRepository.insert).toHaveBeenCalledOnce();
    expect(entity.id).toBeDefined();
    expect(entity.companyId).toBe('company-1');
  });

  it('returns entity (not a plain object) for handler to publish events', async () => {
    const entity = await useCase.execute({
      companyId: 'company-1',
      paymentMethod: 'pix',
      items: [],
      feeConfig: { percentage: 0, fixed: 0 },
      acquirerConfig: { id: 'acq-1', name: 'Test' },
    });

    // The returned value must be an entity instance, not a plain DTO
    expect(entity).toHaveProperty('getUncommittedEvents');
  });
});
```

### Handler test (mock use case and ports)

```typescript
// application/commands/__tests__/create-charge.handler.spec.ts
import { dispatch } from '@/shared/events/event-dispatcher';
import { InMemoryEventPublisher } from '@/shared/events/in-memory-event-publisher';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateChargeHandler } from '../create-charge.handler';
import { CreateChargeCommand } from '../create-charge.command';

const mockQueryBus = { execute: vi.fn() };
const mockRepository = { insert: vi.fn() };
const mockCustomerPort = { findById: vi.fn() };
const mockLogger = { log: vi.fn(), error: vi.fn(), debug: vi.fn() };
const publisher = new InMemoryEventPublisher(() => {
  expect(mockRepository.insert).toHaveBeenCalledOnce();
});
const events = dispatch(publisher);

const acquirerConfig = {
  id: 'acq-1',
  name: 'Test Acquirer',
  supports: vi.fn().mockReturnValue(true),
  getFeeConfig: vi.fn().mockReturnValue({ percentage: 2, fixed: 0 }),
};

describe('CreateChargeHandler', () => {
  let handler: CreateChargeHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    publisher.publications.length = 0;
    mockQueryBus.execute.mockResolvedValue(acquirerConfig);
    mockCustomerPort.findById.mockResolvedValue({
      id: 'customer-1',
      companyId: 'company-1',
    });

    handler = new CreateChargeHandler(
      mockQueryBus as any,
      mockRepository as any,
      mockCustomerPort as any,
      mockLogger as any,
      events,
    );
  });

  it('orchestrates dependencies and returns transaction id', async () => {
    const command = new CreateChargeCommand(
      'company-1',
      'customer-1',
      'pix',
      [{ productId: 'prod-1', quantity: 1 }],
    );

    const result = await handler.execute(command);

    expect(mockQueryBus.execute).toHaveBeenCalledOnce();
    expect(mockCustomerPort.findById).toHaveBeenCalledWith('customer-1');
    expect(publisher.publications).toHaveLength(1);
    expect(result.id).toBeDefined();
  });

  it('throws when payment method not supported', async () => {
    acquirerConfig.supports.mockReturnValue(false);

    const command = new CreateChargeCommand('company-1', 'customer-1', 'credit', []);

    await expect(handler.execute(command)).rejects.toThrow();
  });
});
```

---

## Checklist

- [ ] UseCase has **no** `@Injectable`, `@Inject`, or `@nestjs/cqrs` imports.
- [ ] UseCase returns the entity instance — not `{ id }` or a DTO.
- [ ] Handler constructor instantiates the use case via `new UseCase(deps...)`.
- [ ] `EventDispatcher` is injected in the handler, not the use case.
- [ ] `await events.from(entity).publish()` called in handler after use case returns and the actual transaction commits.
- [ ] Handler resolves all external dependencies before calling `useCase.execute()`.
- [ ] UseCase unit test uses `new UseCase(mockRepo, mockLogger)` — no `Test.createTestingModule`.
- [ ] Handler unit test mocks `QueryBus`, ports, and publisher.
- [ ] Module registers handler in `providers` (self-registers via `@CommandHandler`).
- [ ] Module exports only repository PORT token.
