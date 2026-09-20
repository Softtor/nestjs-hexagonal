import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommandBus } from '@nestjs/cqrs';
import { IssueInvoiceCommand } from '../../application/commands/issue-invoice.command';
import type { IssueInvoiceDto } from '../../application/dtos/issue-invoice.dto';
import { IssueInvoiceRequestDto } from './dtos/issue-invoice.request.dto';
import { JwtAuthGuard } from '@/shared/infrastructure/auth/jwt-auth.guard';

@ApiTags('Invoices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations/:organizationId/invoices')
export class InvoicesController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post()
  @ApiOperation({ summary: 'Issue a new invoice' })
  @ApiCreatedResponse({ description: 'Invoice issued, returns its id' })
  async issue(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: IssueInvoiceRequestDto,
  ): Promise<IssueInvoiceDto.Output> {
    const total = dto.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    return this.commandBus.execute(
      new IssueInvoiceCommand(organizationId, dto.customerId, dto.items, total, dto.dueDate),
    );
  }
}
