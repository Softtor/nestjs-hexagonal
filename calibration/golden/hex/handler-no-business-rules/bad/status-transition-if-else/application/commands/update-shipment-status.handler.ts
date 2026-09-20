import { Inject } from '@nestjs/common';
import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';
import {
  SHIPMENT_REPOSITORY_TOKEN,
  ShipmentRepository,
} from '../../domain/repositories/shipment.repository';
import { ShipmentNotFoundError } from '../../domain/errors/shipment-not-found.error';
import { UpdateShipmentStatusCommand } from './update-shipment-status.command';

@CommandHandler(UpdateShipmentStatusCommand)
export class UpdateShipmentStatusHandler
  implements ICommandHandler<UpdateShipmentStatusCommand, void>
{
  constructor(
    @Inject(SHIPMENT_REPOSITORY_TOKEN)
    private readonly repository: ShipmentRepository.Repository,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: UpdateShipmentStatusCommand): Promise<void> {
    const shipment = await this.repository.findById(command.shipmentId);

    if (!shipment || shipment.organizationId !== command.organizationId) {
      throw new ShipmentNotFoundError(command.shipmentId);
    }

    if (shipment.status === 'pending' && command.event === 'carrier-pickup') {
      shipment.props.status = 'in-transit';
    } else if (shipment.status === 'in-transit' && command.event === 'delivery-scan') {
      shipment.props.status = 'delivered';
    } else if (shipment.status === 'in-transit' && command.event === 'exception') {
      shipment.props.status = 'exception';
    }

    this.publisher.mergeObjectContext(shipment);
    await this.repository.save(shipment);
    shipment.commit();
  }
}
