import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class OrderItemRequestDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  @IsUUID()
  productId: string;

  @ApiProperty({ example: 'Wireless Keyboard' })
  @IsString()
  @Length(1, 200)
  name: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  @IsPositive()
  quantity: number;

  @ApiProperty({ example: 89.99, description: 'Unit price in the order currency' })
  @IsNumber()
  @Min(0)
  unitPrice: number;
}

export class CreateOrderRequestDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  @IsUUID()
  customerId: string;

  @ApiProperty({ example: 'Jane Doe' })
  @IsString()
  @Length(1, 200)
  customerName: string;

  @ApiProperty({ type: [OrderItemRequestDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemRequestDto)
  items: OrderItemRequestDto[];

  @ApiProperty({ example: 'USD', description: 'ISO 4217 currency code' })
  @IsString()
  @Length(3, 3)
  currency: string;

  @ApiPropertyOptional({ example: 'Deliver to the back door' })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  notes?: string;
}
