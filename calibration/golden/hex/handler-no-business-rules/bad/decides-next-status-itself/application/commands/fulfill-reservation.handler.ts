import { Inject } from '@nestjs/common';
import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';
import {
  INVENTORY_REPOSITORY_TOKEN,
  InventoryRepository,
} from '../../domain/repositories/inventory.repository';
import { InventoryItemNotFoundError } from '../../domain/errors/inventory-item-not-found.error';
import { FulfillReservationCommand } from './fulfill-reservation.command';

@CommandHandler(FulfillReservationCommand)
export class FulfillReservationHandler
  implements ICommandHandler<FulfillReservationCommand, void>
{
  constructor(
    @Inject(INVENTORY_REPOSITORY_TOKEN)
    private readonly repository: InventoryRepository.Repository,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: FulfillReservationCommand): Promise<void> {
    const item = await this.repository.findById(command.itemId);

    if (!item || item.organizationId !== command.organizationId) {
      throw new InventoryItemNotFoundError(command.itemId);
    }

    item.reservedQuantity = item.reservedQuantity - command.quantity;
    item.availableQuantity = item.availableQuantity - command.quantity;
    item.status = item.availableQuantity === 0 ? 'out-of-stock' : 'in-stock';

    this.publisher.mergeObjectContext(item);
    await this.repository.save(item);
    item.commit();
  }
}
