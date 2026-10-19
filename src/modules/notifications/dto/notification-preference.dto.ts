import { ApiProperty } from '@nestjs/swagger';
import { NotificationChannel, NotificationType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, ValidateNested } from 'class-validator';

export class NotificationPreferenceResponseDto {
  @ApiProperty({ enum: NotificationType, example: NotificationType.ORDER_PAID })
  notificationType: NotificationType;

  @ApiProperty({ enum: NotificationChannel, example: NotificationChannel.EMAIL })
  channel: NotificationChannel;

  @ApiProperty({ example: true })
  enabled: boolean;
}

export class NotificationPreferencesResponseDto {
  @ApiProperty({ type: [NotificationPreferenceResponseDto] })
  preferences: NotificationPreferenceResponseDto[];
}

export class UpdateNotificationPreferenceDto {
  @ApiProperty({ enum: NotificationType, example: NotificationType.PAYMENT_FAILED })
  @IsEnum(NotificationType)
  notificationType: NotificationType;

  @ApiProperty({ enum: NotificationChannel, example: NotificationChannel.EMAIL })
  @IsEnum(NotificationChannel)
  channel: NotificationChannel;

  @ApiProperty({ example: false })
  @IsBoolean()
  enabled: boolean;
}

export class UpdateNotificationPreferencesDto {
  @ApiProperty({ type: [UpdateNotificationPreferenceDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateNotificationPreferenceDto)
  preferences: UpdateNotificationPreferenceDto[];
}
