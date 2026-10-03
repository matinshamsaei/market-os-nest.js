import { ApiProperty } from '@nestjs/swagger';
import { PaymentProviderType, PaymentStatus } from '@prisma/client';

export class PaymentResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  orderId: string;

  @ApiProperty({ enum: PaymentProviderType })
  provider: PaymentProviderType;

  @ApiProperty({ required: false, nullable: true })
  providerPaymentId: string | null;

  @ApiProperty({ enum: PaymentStatus })
  status: PaymentStatus;

  @ApiProperty()
  amount: number;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  attemptCount: number;

  @ApiProperty({ required: false, nullable: true })
  lastError: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
