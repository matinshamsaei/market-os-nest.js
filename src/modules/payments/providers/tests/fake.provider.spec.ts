import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { createHmac } from 'crypto';

import { FakeProvider } from '../fake.provider';

describe('FakeProvider', () => {
  let provider: FakeProvider;

  const secret = 'test-webhook-secret';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FakeProvider,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === 'PAYMENT_WEBHOOK_SECRET' ? secret : undefined),
          },
        },
      ],
    }).compile();

    provider = module.get(FakeProvider);
  });

  it('creates a payment with a redirect URL', async () => {
    const result = await provider.createPayment({
      paymentId: 'payment-1',
      orderId: 'order-1',
      amount: 100,
      currency: 'IRR',
    });

    expect(result.providerPaymentId).toMatch(/^fake_/);
    expect(result.paymentUrl).toContain(result.providerPaymentId);
    expect(result.paymentUrl).toContain('orderId=order-1');
  });

  it('captures a payment successfully', async () => {
    await expect(provider.capture({ providerPaymentId: 'fake_123', amount: 100 })).resolves.toEqual(
      { success: true },
    );
  });

  it('refunds a payment with a provider refund id', async () => {
    const result = await provider.refund({ providerPaymentId: 'fake_123', amount: 50 });

    expect(result.providerRefundId).toMatch(/^fake_refund_/);
  });

  it('verifies a signed webhook payload', async () => {
    const rawBody = JSON.stringify({
      eventId: 'evt_1',
      type: 'payment.succeeded',
      providerPaymentId: 'fake_123',
      amount: 100,
    });
    const signature = createHmac('sha256', secret).update(rawBody).digest('hex');

    await expect(
      provider.verifyWebhook({
        rawBody,
        signature,
      }),
    ).resolves.toEqual({
      eventId: 'evt_1',
      type: 'payment.succeeded',
      providerPaymentId: 'fake_123',
      amount: 100,
    });
  });

  it('rejects webhooks with an invalid signature', async () => {
    const rawBody = JSON.stringify({
      eventId: 'evt_1',
      type: 'payment.succeeded',
      providerPaymentId: 'fake_123',
      amount: 100,
    });

    await expect(
      provider.verifyWebhook({
        rawBody,
        signature: 'invalid',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects webhooks with an invalid event shape', async () => {
    const rawBody = JSON.stringify({ eventId: 'evt_1' });
    const signature = createHmac('sha256', secret).update(rawBody).digest('hex');

    await expect(
      provider.verifyWebhook({
        rawBody,
        signature,
      }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
