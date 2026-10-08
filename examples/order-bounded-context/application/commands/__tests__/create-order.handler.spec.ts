import { describe, expect, it } from 'vitest';
import { dispatch } from '@/shared/events/event-dispatcher';
import { InMemoryEventPublisher } from '@/shared/events/in-memory-event-publisher';
import { OrderInMemoryRepository } from '../../../infrastructure/database/in-memory/repositories/order-in-memory.repository';
import { CreateOrderHandler } from '../create-order.handler';
import { CreateOrderCommand } from '../create-order.command';
import { OrderDataBuilder } from '../../../domain/testing/helpers/order.data-builder';

function makeCommand() {
  const input = OrderDataBuilder();
  return new CreateOrderCommand(input.organizationId, input.customerId, input.customerName, input.items, input.currency, input.notes);
}

describe('CreateOrderHandler', () => {
  it('persists the order before publication and returns its id', async () => {
    const repository = new OrderInMemoryRepository();
    const publisher = new InMemoryEventPublisher(async publication => {
      if (publication.kind !== 'instance') throw new Error('expected domain event');
      const event = publication.event as { aggregateId: string };
      expect(await repository.findById(event.aggregateId)).not.toBeNull();
    });
    const command = makeCommand();
    const result = await new CreateOrderHandler(repository, dispatch(publisher)).execute(command);
    const saved = await repository.findById(result.id);
    expect(saved?.organizationId).toBe(command.organizationId);
    expect(saved?.getUncommittedEvents()).toEqual([]);
    expect(publisher.publications).toHaveLength(1);
  });

  it('does not publish when persistence fails', async () => {
    const repository = new OrderInMemoryRepository();
    repository.save = async () => { throw new Error('write failed'); };
    const publisher = new InMemoryEventPublisher();
    await expect(new CreateOrderHandler(repository, dispatch(publisher)).execute(makeCommand())).rejects.toThrow('write failed');
    expect(publisher.publications).toEqual([]);
  });

  it('retains events when the publisher fails after persistence', async () => {
    const repository = new OrderInMemoryRepository();
    const publisher = new InMemoryEventPublisher(() => { throw new Error('broker offline'); });
    await expect(new CreateOrderHandler(repository, dispatch(publisher)).execute(makeCommand())).rejects.toThrow('broker offline');
    const [order] = await repository.findAll();
    expect(order.getUncommittedEvents()).toHaveLength(1);
    expect(publisher.publications).toEqual([]);
  });
});
