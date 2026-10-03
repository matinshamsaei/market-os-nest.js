import { ApiProperty } from '@nestjs/swagger';
import { PaymentStatus } from '@prisma/client';

export class WebhookResponseDto {
  @ApiProperty({ example: true })
  received: boolean;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000', required: false })
  paymentId?: string;

  @ApiProperty({ enum: PaymentStatus, required: false })
  status?: PaymentStatus;
}
