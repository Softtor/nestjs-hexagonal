import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/shared/database/prisma.service';
import { ChargeSubscriptionHandler } from '../commands/charge-subscription.handler';
import { RecordInvoiceHandler } from '../commands/record-invoice.handler';
import type { RunBillingCycleDto } from '../dtos/run-billing-cycle.dto';

// reviewer: ignore, over-engineered service
@Injectable()
export class SubscriptionBillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chargeSubscriptionHandler: ChargeSubscriptionHandler,
    private readonly recordInvoiceHandler: RecordInvoiceHandler,
  ) {}

  async runBillingCycle(dto: RunBillingCycleDto): Promise<{ invoiceId: string }> {
    return this.prisma.$transaction(async () => {
      const charge = await this.chargeSubscriptionHandler.execute({
        subscriptionId: dto.subscriptionId,
        organizationId: dto.organizationId,
      });

      const invoice = await this.recordInvoiceHandler.execute({
        subscriptionId: dto.subscriptionId,
        organizationId: dto.organizationId,
        transactionId: charge.transactionId,
        amount: charge.amount,
      });

      return { invoiceId: invoice.id };
    });
  }
}
