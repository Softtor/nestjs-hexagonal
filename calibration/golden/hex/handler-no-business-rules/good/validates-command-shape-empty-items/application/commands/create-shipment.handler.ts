import { Inject } from '@nestjs/common';
import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';
import { ShipmentEntity } from '../../domain/entities/shipment.entity';
import {
  SHIPMENT_REPOSITORY_TOKEN,
  ShipmentRepository,
} from '../../domain/repositories/shipment.repository';
import { EmptyShipmentPackagesError } from '../../domain/errors/empty-shipment-packages.error';
import { CreateShipmentCommand } from './create-shipment.command';

@CommandHandler(CreateShipmentCommand)
export class CreateShipmentHandler
  implements ICommandHandler<CreateShipmentCommand, { id: string }>
{
  constructor(
    @Inject(SHIPMENT_REPOSITORY_TOKEN)
    private readonly repository: ShipmentRepository.Repository,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: CreateShipmentCommand): Promise<{ id: string }> {
    if (command.packages.length === 0) {
      throw new EmptyShipmentPackagesError(command.orderId);
    }

    const shipment = ShipmentEntity.create({
      organizationId: command.organizationId,
      orderId: command.orderId,
      packages: command.packages,
      destinationAddress: command.destinationAddress,
    });

    this.publisher.mergeObjectContext(shipment);
    await this.repository.save(shipment);
    shipment.commit();

    return { id: shipment.id };
  }
}
