import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class CancelOrderRequestDto {
  @ApiProperty({ example: 'Customer changed their mind' })
  @IsString()
  @Length(3, 500)
  reason: string;
}
