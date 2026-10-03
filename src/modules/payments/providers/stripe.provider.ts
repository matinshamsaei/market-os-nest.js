import { Injectable, NotImplementedException } from '@nestjs/common';

import type {
  CapturePaymentInput,
  CapturePaymentResult,
  CreatePaymentInput,
  CreatePaymentResult,
  GetPaymentStatusInput,
  GetPaymentStatusResult,
  PaymentProvider,
  PaymentWebhookEvent,
  RefundPaymentInput,
  RefundPaymentResult,
  VerifyWebhookInput,
} from './types';

@Injectable()
export class StripeProvider implements PaymentProvider {
  createPayment(_input: CreatePaymentInput): Promise<CreatePaymentResult> {
    throw new NotImplementedException('Stripe provider is not configured');
  }

  capture(_input: CapturePaymentInput): Promise<CapturePaymentResult> {
    throw new NotImplementedException('Stripe provider is not configured');
  }

  refund(_input: RefundPaymentInput): Promise<RefundPaymentResult> {
    throw new NotImplementedException('Stripe provider is not configured');
  }

  verifyWebhook(_input: VerifyWebhookInput): Promise<PaymentWebhookEvent> {
    throw new NotImplementedException('Stripe webhook verification is not configured');
  }

  getPaymentStatus(_input: GetPaymentStatusInput): Promise<GetPaymentStatusResult> {
    throw new NotImplementedException('Stripe payment status is not configured');
  }
}
