import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EventPublisher } from '@nestjs/cqrs';
import { CreateOrderHandler } from '../create-order.handler';
import { CreateOrderCommand } from '../create-order.command';
import { OrderDataBuilder } from '../../../domain/testing/helpers/order.data-builder';
import type { OrderRepository } from '../../../domain/repositories/order.repository';

function makeRepository(): OrderRepository.Repository {
  return {
    save: vi.fn().mockResolvedValue(undefined),
    findById: vi.fn(),
    findByOrganization: vi.fn(),
    delete: vi.fn(),
    search: vi.fn(),
    insert: vi.fn(),
    findAll: vi.fn(),
    update: vi.fn(),
    sortableFields: ['createdAt'],
  };
}

function makePublisher(): EventPublisher {
  return {
    mergeObjectContext: vi.fn().mockImplementation((entity) => entity),
    mergeClassContext: vi.fn(),
  } as unknown as EventPublisher;
}

describe('CreateOrderHandler', () => {
  let handler: CreateOrderHandler;
  let repository: OrderRepository.Repository;
  let publisher: EventPublisher;

  beforeEach(() => {
    repository = makeRepository();
    publisher = makePublisher();
    handler = new CreateOrderHandler(repository, publisher);
  });

  it('creates an order and returns its id', async () => {
    const input = OrderDataBuilder();
    const command = new CreateOrderCommand(
      input.organizationId,
      input.customerId,
      input.customerName,
      input.items,
      input.currency,
      input.notes,
    );

    const result = await handler.execute(command);

    expect(result.id).toBeDefined();
    expect(typeof result.id).toBe('string');
  });

  it('persists the order via repository.save', async () => {
    const input = OrderDataBuilder();
    const command = new CreateOrderCommand(
      input.organizationId,
      input.customerId,
      input.customerName,
      input.items,
      input.currency,
    );

    await handler.execute(command);

    expect(repository.save).toHaveBeenCalledOnce();
  });

  it('calls mergeObjectContext before save and commit after save', async () => {
    const saveSpy = vi.fn().mockResolvedValue(undefined);
    const mergeOrder: string[] = [];

    repository.save = vi.fn().mockImplementation(async () => {
      mergeOrder.push('save');
    });

    let committedEntity: { commit: () => void } | null = null;
    publisher.mergeObjectContext = vi.fn().mockImplementation((entity) => {
      mergeOrder.push('merge');
      // Capture entity to verify commit is called after save
      committedEntity = entity as { commit: () => void };
      const originalCommit = (entity as { commit: () => void }).commit.bind(entity);
      (entity as { commit: () => void }).commit = vi.fn().mockImplementation(() => {
        mergeOrder.push('commit');
        originalCommit();
      });
      return entity;
    });

    const input = OrderDataBuilder();
    const command = new CreateOrderCommand(
      input.organizationId,
      input.customerId,
      input.customerName,
      input.items,
      input.currency,
    );

    await handler.execute(command);

    // merge must happen before save; commit must happen after save
    expect(mergeOrder).toEqual(['merge', 'save', 'commit']);
    void saveSpy;
    void committedEntity;
  });

  it('sets the correct organizationId on the created order', async () => {
    const input = OrderDataBuilder();
    const command = new CreateOrderCommand(
      input.organizationId,
      input.customerId,
      input.customerName,
      input.items,
      input.currency,
    );

    await handler.execute(command);

    const savedEntity = (repository.save as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(savedEntity.organizationId).toBe(input.organizationId);
  });
});
