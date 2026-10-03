import { PaymentProviderType } from '@prisma/client';

export interface CreatePaymentInput {
  paymentId: string;
  orderId: string;
  amount: number;
  currency: string;
  callbackUrl?: string;
}

export interface CreatePaymentResult {
  providerPaymentId: string;
  paymentUrl: string;
}

export interface CapturePaymentInput {
  providerPaymentId: string;
  amount: number;
}

export interface CapturePaymentResult {
  success: boolean;
}

export interface RefundPaymentInput {
  providerPaymentId: string;
  amount: number;
}

export interface RefundPaymentResult {
  providerRefundId: string;
}

export type ProviderPaymentStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'REFUNDED';

export interface GetPaymentStatusInput {
  providerPaymentId: string;
  amount?: number;
}

export interface GetPaymentStatusResult {
  status: ProviderPaymentStatus;
}

export type PaymentWebhookEventType =
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.cancelled'
  | 'payment.refunded';

export interface PaymentWebhookEvent {
  eventId: string;
  type: PaymentWebhookEventType;
  providerPaymentId: string;
  amount?: number;
}

export interface VerifyWebhookInput {
  rawBody: string;
  signature?: string;
  providerHint?: PaymentProviderType;
}

export interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  capture(input: CapturePaymentInput): Promise<CapturePaymentResult>;
  refund(input: RefundPaymentInput): Promise<RefundPaymentResult>;
  verifyWebhook(input: VerifyWebhookInput): Promise<PaymentWebhookEvent>;
  getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusResult>;
}
