import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';

import { TransientPaymentError } from '../helpers/payment-retry.policy';
import type {
  CapturePaymentInput,
  CapturePaymentResult,
  CreatePaymentInput,
  CreatePaymentResult,
  GetPaymentStatusInput,
  GetPaymentStatusResult,
  PaymentProvider,
  PaymentWebhookEvent,
  ProviderPaymentStatus,
  RefundPaymentInput,
  RefundPaymentResult,
  VerifyWebhookInput,
} from './types';

const WEBHOOK_EVENT_TYPES = new Set([
  'payment.succeeded',
  'payment.failed',
  'payment.cancelled',
  'payment.refunded',
]);

@Injectable()
export class FakeProvider implements PaymentProvider {
  private readonly statuses = new Map<string, ProviderPaymentStatus>();
  private createFailuresRemaining = 0;

  constructor(private readonly configService: ConfigService) {}

  simulateTransientFailures(count: number): void {
    this.createFailuresRemaining = count;
  }

  setPaymentStatus(providerPaymentId: string, status: ProviderPaymentStatus): void {
    this.statuses.set(providerPaymentId, status);
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    if (this.createFailuresRemaining > 0) {
      this.createFailuresRemaining -= 1;
      throw new TransientPaymentError('Gateway timeout');
    }

    const providerPaymentId = `fake_${randomUUID()}`;
    this.statuses.set(providerPaymentId, 'PROCESSING');

    return Promise.resolve({
      providerPaymentId,
      paymentUrl: `https://fake-payment.example.com/pay/${providerPaymentId}?orderId=${input.orderId}&amount=${input.amount}`,
    });
  }

  async capture(input: CapturePaymentInput): Promise<CapturePaymentResult> {
    this.statuses.set(input.providerPaymentId, 'SUCCEEDED');
    return Promise.resolve({ success: true });
  }

  async refund(input: RefundPaymentInput): Promise<RefundPaymentResult> {
    this.statuses.set(input.providerPaymentId, 'REFUNDED');
    return Promise.resolve({ providerRefundId: `fake_refund_${randomUUID()}` });
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusResult> {
    return Promise.resolve({
      status: this.statuses.get(input.providerPaymentId) ?? 'PROCESSING',
    });
  }

  async verifyWebhook(input: VerifyWebhookInput): Promise<PaymentWebhookEvent> {
    const secret = this.configService.get<string>('PAYMENT_WEBHOOK_SECRET');

    if (!secret) {
      throw new UnauthorizedException('PAYMENT_WEBHOOK_SECRET is not configured');
    }

    if (!input.signature || !this.isValidSignature(input.rawBody, input.signature, secret)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    let payload: Record<string, unknown>;

    try {
      payload = JSON.parse(input.rawBody) as Record<string, unknown>;
    } catch {
      throw new UnauthorizedException('Invalid webhook payload');
    }

    const eventId = typeof payload.eventId === 'string' ? payload.eventId : undefined;
    const type = typeof payload.type === 'string' ? payload.type : undefined;
    const providerPaymentId =
      typeof payload.providerPaymentId === 'string' ? payload.providerPaymentId : undefined;
    const amount = typeof payload.amount === 'number' ? payload.amount : undefined;

    if (!eventId || !type || !providerPaymentId || !WEBHOOK_EVENT_TYPES.has(type)) {
      throw new UnauthorizedException('Invalid webhook event');
    }

    const eventType = type as PaymentWebhookEvent['type'];
    this.statuses.set(providerPaymentId, this.mapEventToProviderStatus(eventType));

    return Promise.resolve({
      eventId,
      type: eventType,
      providerPaymentId,
      amount,
    });
  }

  signPayload(rawBody: string, secret?: string): string {
    const webhookSecret = secret ?? this.configService.get<string>('PAYMENT_WEBHOOK_SECRET');

    if (!webhookSecret) {
      throw new UnauthorizedException('PAYMENT_WEBHOOK_SECRET is not configured');
    }

    return createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  }

  private mapEventToProviderStatus(type: PaymentWebhookEvent['type']): ProviderPaymentStatus {
    switch (type) {
      case 'payment.succeeded':
        return 'SUCCEEDED';
      case 'payment.failed':
        return 'FAILED';
      case 'payment.cancelled':
        return 'CANCELLED';
      case 'payment.refunded':
        return 'REFUNDED';
      default:
        return 'PROCESSING';
    }
  }

  private isValidSignature(rawBody: string, signature: string, secret: string): boolean {
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

    try {
      return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false;
    }
  }
}
