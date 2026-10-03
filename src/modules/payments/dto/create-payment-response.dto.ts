import { ApiProperty } from '@nestjs/swagger';

export class CreatePaymentResponseDto {
  @ApiProperty({ example: 'https://fake-payment.example.com/pay/fake_abc123' })
  paymentUrl: string;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  paymentId: string;
}
