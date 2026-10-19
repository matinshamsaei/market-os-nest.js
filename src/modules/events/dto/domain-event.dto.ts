import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DomainEventStatus } from '@prisma/client';

export class DomainEventResponseDto {
  @ApiProperty({ example: 'order-paid-payment-1' })
  id: string;

  @ApiProperty({ example: 'order.paid' })
  type: string;

  @ApiProperty({ example: { orderId: 'order-1', userId: 'user-1' } })
  payload: unknown;

  @ApiProperty({ enum: DomainEventStatus, example: DomainEventStatus.FAILED })
  status: DomainEventStatus;

  @ApiProperty({ example: 2 })
  attemptCount: number;

  @ApiProperty({ example: 5 })
  maxAttempts: number;

  @ApiPropertyOptional({ example: 'Database temporarily unavailable', nullable: true })
  lastError: string | null;

  @ApiPropertyOptional({ example: '2026-01-01T00:00:01.000Z', nullable: true })
  nextRetryAt: Date | null;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  occurredAt: Date;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-01-01T00:00:01.000Z' })
  updatedAt: Date;
}
