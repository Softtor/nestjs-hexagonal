import type { Request, Response } from 'express';

export interface ShipmentWebhookPort {
  handleCarrierCallback(req: Request, res: Response): Promise<void>;
}

export const SHIPMENT_WEBHOOK_PORT = Symbol('ShipmentWebhookPort');
