# Event Handler Infrastructure — Full Template

Event handlers react to domain events and perform side effects. They are part of the infrastructure layer because they depend on external systems (RabbitMQ, WebSocket, Redis, email).

## Core Rules

- Use `@EventsHandler` + `IEventHandler` — never `@OnEvent` for new code.
- Handlers must never throw — wrap in `try/catch` and log errors.
- Handler failure must not affect the transaction that caused the event.
- `handle()` is called after `await events.from(entity).publish()` in the command handler.

## Basic Event Handler

```typescript
// infrastructure/listeners/<context>-created.handler.ts
import { Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { <Context>CreatedEvent } from '../../domain/events/<context>-created.event';

@EventsHandler(<Context>CreatedEvent)
export class <Context>CreatedHandler implements IEventHandler<<Context>CreatedEvent> {
  private readonly logger = new Logger(<Context>CreatedHandler.name);

  async handle(event: <Context>CreatedEvent): Promise<void> {
    try {
      this.logger.log(`<Context> created: ${event.entityId}`);
      // side effects go here
    } catch (error) {
      this.logger.error(
        `Failed to handle <Context>CreatedEvent for ${event.entityId}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
```

## Projection Updater (Redis Read Model)

```typescript
// infrastructure/listeners/<context>-updated.projection.ts
import { Inject, Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { <Context>UpdatedEvent } from '../../domain/events/<context>-updated.event';
import { REDIS_READ_MODEL_TOKEN } from '../../application/ports/redis-read-model.port';
import type { RedisReadModelPort } from '../../application/ports/redis-read-model.port';

export interface <Context>View {
  id: string;
  name: string;
  organizationId: string;
  updatedAt: string;
}

@EventsHandler(<Context>UpdatedEvent)
export class <Context>UpdatedProjection implements IEventHandler<<Context>UpdatedEvent> {
  private readonly logger = new Logger(<Context>UpdatedProjection.name);

  constructor(
    @Inject(REDIS_READ_MODEL_TOKEN)
    private readonly readModel: RedisReadModelPort,
  ) {}

  async handle(event: <Context>UpdatedEvent): Promise<void> {
    try {
      const view: <Context>View = {
        id: event.entityId,
        name: event.name,
        organizationId: event.organizationId,
        updatedAt: new Date().toISOString(),
      };
      await this.readModel.set(`<context>:${event.entityId}`, view, 3600);
      this.logger.debug(`Updated <context> projection: ${event.entityId}`);
    } catch (error) {
      this.logger.error(
        `Projection update failed for <context> ${event.entityId}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
```

## Notification Handler (RabbitMQ / Webhook / Email)

```typescript
// infrastructure/listeners/<context>-created-notification.handler.ts
import { Inject, Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { <Context>CreatedEvent } from '../../domain/events/<context>-created.event';
import { MESSAGING_PORT } from '../../application/ports/messaging.port';
import type { MessagingPort } from '../../application/ports/messaging.port';

@EventsHandler(<Context>CreatedEvent)
export class <Context>CreatedNotificationHandler
  implements IEventHandler<<Context>CreatedEvent>
{
  private readonly logger = new Logger(<Context>CreatedNotificationHandler.name);

  constructor(
    @Inject(MESSAGING_PORT)
    private readonly messaging: MessagingPort,
  ) {}

  async handle(event: <Context>CreatedEvent): Promise<void> {
    try {
      await this.messaging.publish('<context>.created', {
        entityId: event.entityId.toString(),
        organizationId: event.organizationId,
        occurredAt: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error(
        `Failed to publish <context>.created event: ` +
        `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
```

## Multiple Handlers for the Same Event

NestJS CQRS supports multiple `@EventsHandler` decorators for the same event class. Register each in module providers separately.

```typescript
// Two handlers for the same event
@EventsHandler(<Context>CreatedEvent)
export class <Context>AuditLogHandler implements IEventHandler<<Context>CreatedEvent> { ... }

@EventsHandler(<Context>CreatedEvent)
export class <Context>WelcomeEmailHandler implements IEventHandler<<Context>CreatedEvent> { ... }

// In module providers:
// <Context>AuditLogHandler,
// <Context>WelcomeEmailHandler,
```

## Module Registration

```typescript
// In infrastructure/<context>.module.ts providers array:
<Context>CreatedHandler,
<Context>UpdatedProjection,
<Context>CreatedNotificationHandler,
```

No additional configuration needed — NestJS auto-registers via `@EventsHandler` decorator.

## Testing Event Handlers

```typescript
// infrastructure/listeners/__tests__/<context>-created.handler.spec.ts
import { describe, it, beforeEach, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { <Context>CreatedHandler } from '../<context>-created.handler';
import { <Context>CreatedEvent } from '../../../domain/events/<context>-created.event';
import { UniqueEntityID } from '@/shared/base-classes/unique-entity-id';

describe('<Context>CreatedHandler', () => {
  const mockMessaging = { publish: vi.fn() };
  let handler: <Context>CreatedHandler;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        <Context>CreatedHandler,
        { provide: MESSAGING_PORT, useValue: mockMessaging },
      ],
    }).compile();

    handler = module.get(<Context>CreatedHandler);
  });

  it('publishes the created event', async () => {
    const event = new <Context>CreatedEvent(new UniqueEntityID('entity-1'), 'org-1');
    await handler.handle(event);

    expect(mockMessaging.publish).toHaveBeenCalledWith(
      '<context>.created',
      expect.objectContaining({ entityId: 'entity-1' }),
    );
  });

  it('does not throw when messaging fails', async () => {
    mockMessaging.publish.mockRejectedValue(new Error('Connection refused'));
    const event = new <Context>CreatedEvent(new UniqueEntityID('entity-1'), 'org-1');

    // Should resolve without throwing
    await expect(handler.handle(event)).resolves.toBeUndefined();
  });
});
```

## Event Lifecycle Recap

```
1. entity.apply(new <Context>CreatedEvent(...))   // records the event in entity
2. await repository.save(entity)                 // pure persistence
3. await transactionCommit                       // actual database commit, if present
4. await events.from(entity).publish()             // adapter completion, then acknowledgement
5. EventBus adapter hands instances to @EventsHandler listeners
```

The repository never knows about events. The command handler owns publication after the actual transaction commit.
