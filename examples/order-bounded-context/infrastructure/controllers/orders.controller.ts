import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { CreateOrderCommand } from '../../application/commands/create-order.command';
import { CancelOrderCommand } from '../../application/commands/cancel-order.command';
import { GetOrderQuery } from '../../application/queries/get-order.query';
import { ListOrdersQuery } from '../../application/queries/list-orders.query';
import type { CreateOrderDto } from '../../application/dtos/create-order.dto';
import type { OrderOutputDto, OrderListOutputDto } from '../../application/dtos/order-output.mapper';
import { CreateOrderRequestDto } from './dtos/create-order.request.dto';
import { CancelOrderRequestDto } from './dtos/cancel-order.request.dto';
import { ListOrdersRequestDto } from './dtos/list-orders.request.dto';
import { JwtAuthGuard } from '@/shared/infrastructure/auth/jwt-auth.guard';
import { CurrentOrganization } from '@/shared/infrastructure/auth/current-organization.decorator';

@ApiTags('Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations/:organizationId/orders')
export class OrdersController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Place a new order' })
  @ApiCreatedResponse({ description: 'Order created, returns its id' })
  async create(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateOrderRequestDto,
  ): Promise<CreateOrderDto.Output> {
    return this.commandBus.execute(
      new CreateOrderCommand(
        organizationId,
        dto.customerId,
        dto.customerName,
        dto.items,
        dto.currency,
        dto.notes,
      ),
    );
  }

  @Get(':orderId')
  @ApiOperation({ summary: 'Get a single order by id' })
  @ApiOkResponse({ description: 'Order details' })
  async findOne(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<OrderOutputDto> {
    return this.queryBus.execute(new GetOrderQuery(orderId, organizationId));
  }

  @Get()
  @ApiOperation({ summary: 'List orders with optional filters and pagination' })
  @ApiOkResponse({ description: 'Paginated list of orders' })
  async list(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Query() query: ListOrdersRequestDto,
  ): Promise<OrderListOutputDto> {
    return this.queryBus.execute(
      new ListOrdersQuery(
        organizationId,
        query.page,
        query.perPage,
        query.status,
        query.customerId,
      ),
    );
  }

  @Post(':orderId/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel an order' })
  @ApiNoContentResponse({ description: 'Order cancelled' })
  async cancel(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CancelOrderRequestDto,
    @CurrentOrganization() _org: unknown,
  ): Promise<void> {
    await this.commandBus.execute(
      new CancelOrderCommand(orderId, organizationId, dto.reason),
    );
  }
}
