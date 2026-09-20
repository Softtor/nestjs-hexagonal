import { Inject } from '@nestjs/common';
import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';
import {
  SHIPMENT_REPOSITORY_TOKEN,
  ShipmentRepository,
} from '../../domain/repositories/shipment.repository';
import { CARRIER_PORT_TOKEN, CarrierPort } from '../ports/carrier.port';
import { ShipmentNotFoundError } from '../../domain/errors/shipment-not-found.error';
import { DispatchShipmentCommand } from './dispatch-shipment.command';

@CommandHandler(DispatchShipmentCommand)
export class DispatchShipmentHandler
  implements ICommandHandler<DispatchShipmentCommand, void>
{
  constructor(
    @Inject(SHIPMENT_REPOSITORY_TOKEN)
    private readonly repository: ShipmentRepository.Repository,
    @Inject(CARRIER_PORT_TOKEN)
    private readonly carrier: CarrierPort,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: DispatchShipmentCommand): Promise<void> {
    const shipment = await this.repository.findById(command.shipmentId);

    if (!shipment || shipment.organizationId !== command.organizationId) {
      throw new ShipmentNotFoundError(command.shipmentId);
    }

    const trackingCode = await this.carrier.requestPickup(shipment.id);

    // safe: orchestration only, trackingCode comes straight from the carrier port
    shipment.dispatch(trackingCode);

    this.publisher.mergeObjectContext(shipment);
    await this.repository.save(shipment);
    shipment.commit();
  }
}
