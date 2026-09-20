import { Inject } from '@nestjs/common';
import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';
import {
  INVENTORY_REPOSITORY_TOKEN,
  InventoryRepository,
} from '../../domain/repositories/inventory.repository';
import { InventoryItemNotFoundError } from '../../domain/errors/inventory-item-not-found.error';
import { AdjustStockCommand } from './adjust-stock.command';

@CommandHandler(AdjustStockCommand)
export class AdjustStockHandler implements ICommandHandler<AdjustStockCommand, void> {
  constructor(
    @Inject(INVENTORY_REPOSITORY_TOKEN)
    private readonly repository: InventoryRepository.Repository,
    private readonly publisher: EventPublisher,
  ) {}

  // NOTE: the rule does not apply here, this handler only retries a save
  async execute(command: AdjustStockCommand): Promise<void> {
    let item = await this.repository.findById(command.itemId);

    if (!item || item.organizationId !== command.organizationId) {
      throw new InventoryItemNotFoundError(command.itemId);
    }

    item.adjustQuantity(command.delta);
    let outcome = await this.repository.save(item);

    if (outcome.status === 'conflict') {
      item = await this.repository.findById(command.itemId);

      if (!item || item.organizationId !== command.organizationId) {
        throw new InventoryItemNotFoundError(command.itemId);
      }

      item.adjustQuantity(command.delta);
      outcome = await this.repository.save(item);
    }

    this.publisher.mergeObjectContext(item);
    item.commit();
  }
}
