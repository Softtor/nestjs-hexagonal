import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateInvoiceUseCase } from '../../application/use-cases/create-invoice.use-case';
import type { CreateInvoiceDto } from '../../application/dtos/create-invoice.dto';
import { CreateInvoiceRequestDto } from './dtos/create-invoice.request.dto';
import { JwtAuthGuard } from '@/shared/infrastructure/auth/jwt-auth.guard';

@ApiTags('Invoices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations/:organizationId/invoices')
export class InvoicesController {
  constructor(private readonly createInvoice: CreateInvoiceUseCase) {}

  @Post()
  @ApiOperation({ summary: 'Create a new invoice' })
  @ApiCreatedResponse({ description: 'Invoice created, returns its id' })
  async create(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateInvoiceRequestDto,
  ): Promise<CreateInvoiceDto.Output> {
    return this.createInvoice.execute({
      organizationId,
      customerId: dto.customerId,
      items: dto.items,
      dueDate: dto.dueDate,
    });
  }
}
