import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { OrderStatus } from '../../../constants/enums';

export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus)
  status!: OrderStatus;

  @IsOptional()
  @IsString()
  workerId?: string;
}

export class RateOrderDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsString()
  comment!: string;
}

export class CancelOrderDto {
  @IsString()
  cancelReason!: string;
}
