import { Inject } from '@nestjs/common';
import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';
import {
  INVENTORY_REPOSITORY_TOKEN,
  InventoryRepository,
} from '../../domain/repositories/inventory.repository';
import { InventoryItemNotFoundError } from '../../domain/errors/inventory-item-not-found.error';
import { ReserveStockCommand } from './reserve-stock.command';

@CommandHandler(ReserveStockCommand)
export class ReserveStockHandler implements ICommandHandler<ReserveStockCommand, void> {
  constructor(
    @Inject(INVENTORY_REPOSITORY_TOKEN)
    private readonly repository: InventoryRepository.Repository,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: ReserveStockCommand): Promise<void> {
    let item = await this.repository.findById(command.itemId);

    if (!item || item.organizationId !== command.organizationId) {
      throw new InventoryItemNotFoundError(command.itemId);
    }

    item.reserve(command.quantity);
    let outcome = await this.repository.save(item);

    if (outcome.status === 'conflict') {
      item = await this.repository.findById(command.itemId);

      if (!item || item.organizationId !== command.organizationId) {
        throw new InventoryItemNotFoundError(command.itemId);
      }

      item.reserve(command.quantity);
      outcome = await this.repository.save(item);
    }

    this.publisher.mergeObjectContext(item);
    item.commit();
  }
}
