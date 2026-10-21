import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { NotificationChannel, NotificationStatus, NotificationType } from '@prisma/client';

import { PaginationMetaDto, PaginationQueryParamsDto } from '@/shared/pagination';

export class GetNotificationsQueryDto extends PaginationQueryParamsDto {
  @ApiPropertyOptional({ enum: NotificationType, example: NotificationType.ORDER_PAID })
  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  @ApiPropertyOptional({ enum: NotificationStatus, example: NotificationStatus.SENT })
  @IsOptional()
  @IsEnum(NotificationStatus)
  status?: NotificationStatus;

  @ApiPropertyOptional({ enum: NotificationChannel, example: NotificationChannel.IN_APP })
  @IsOptional()
  @IsEnum(NotificationChannel)
  channel?: NotificationChannel;
}

export class NotificationResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440001' })
  userId: string;

  @ApiProperty({ enum: NotificationType, example: NotificationType.ORDER_PAID })
  type: NotificationType;

  @ApiProperty({ enum: NotificationChannel, example: NotificationChannel.IN_APP })
  channel: NotificationChannel;

  @ApiProperty({ example: 'Order paid' })
  title: string;

  @ApiProperty({ example: 'Your order has been paid.' })
  message: string;

  @ApiProperty({ enum: NotificationStatus, example: NotificationStatus.SENT })
  status: NotificationStatus;

  @ApiPropertyOptional({ example: '2026-01-01T00:00:00.000Z', nullable: true })
  readAt: Date | null;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  createdAt: Date;
}

export class PaginatedNotificationsResponseDto {
  @ApiProperty({ type: [NotificationResponseDto] })
  data: NotificationResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

export class UnreadCountResponseDto {
  @ApiProperty({ example: 3 })
  count: number;
}

export class ReadAllNotificationsResponseDto {
  @ApiProperty({ example: 4 })
  updatedCount: number;
}
