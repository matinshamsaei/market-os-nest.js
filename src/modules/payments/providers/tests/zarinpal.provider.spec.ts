import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { ZarinpalProvider } from '../zarinpal.provider';

describe('ZarinpalProvider', () => {
  let provider: ZarinpalProvider;
  let fetchMock: jest.Mock;

  const config: Record<string, string> = {
    ZARINPAL_MERCHANT_ID: 'merchant-123',
    ZARINPAL_ACCESS_TOKEN: 'access-token',
    ZARINPAL_SANDBOX: 'true',
    PAYMENT_CALLBACK_URL: 'http://localhost:3000/payments/callback',
  };

  beforeEach(async () => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ZarinpalProvider,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultValue?: string) => config[key] ?? defaultValue,
          },
        },
      ],
    }).compile();

    provider = module.get(ZarinpalProvider);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('creates a payment and returns sandbox redirect URL', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => ({
        data: {
          code: 100,
          authority: 'A00000000000000000000000000000000001',
        },
      }),
    });

    const result = await provider.createPayment({
      paymentId: 'payment-1',
      orderId: 'order-1',
      amount: 15000.4,
      currency: 'IRR',
    });

    expect(result.providerPaymentId).toBe('A00000000000000000000000000000000001');
    expect(result.paymentUrl).toBe(
      'https://sandbox.zarinpal.com/pg/StartPay/A00000000000000000000000000000000001',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://sandbox.zarinpal.com/pg/v4/payment/request.json',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          merchant_id: 'merchant-123',
          amount: 15000,
          callback_url:
            'http://localhost:3000/payments/callback?paymentId=payment-1&orderId=order-1',
          description: 'Payment payment-1 for order order-1',
          currency: 'IRR',
          metadata: {
            payment_id: 'payment-1',
            order_id: 'order-1',
          },
        }),
      }),
    );
  });

  it('captures a verified payment', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => ({
        data: { code: 100 },
      }),
    });

    await expect(
      provider.capture({
        providerPaymentId: 'A00000000000000000000000000000000001',
        amount: 15000,
      }),
    ).resolves.toEqual({ success: true });
  });

  it('returns unsuccessful capture for non-success codes', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => ({
        data: { code: -50 },
      }),
    });

    await expect(
      provider.capture({
        providerPaymentId: 'A00000000000000000000000000000000001',
        amount: 15000,
      }),
    ).resolves.toEqual({ success: false });
  });

  it('refunds a payment using the access token', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => ({
        data: { code: 100, ref_id: 98765 },
      }),
    });

    const result = await provider.refund({
      providerPaymentId: 'A00000000000000000000000000000000001',
      amount: 15000,
    });

    expect(result.providerRefundId).toBe('98765');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sandbox.zarinpal.com/pg/v4/payment/refund.json',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
        }),
      }),
    );
  });

  it('throws when merchant id is missing', async () => {
    delete config.ZARINPAL_MERCHANT_ID;

    await expect(
      provider.createPayment({
        paymentId: 'payment-1',
        orderId: 'order-1',
        amount: 15000,
        currency: 'IRR',
      }),
    ).rejects.toThrow(BadRequestException);

    config.ZARINPAL_MERCHANT_ID = 'merchant-123';
  });

  it('throws when Zarinpal create response is invalid', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => ({
        data: { code: -9 },
        errors: [{ message: 'invalid' }],
      }),
    });

    await expect(
      provider.createPayment({
        paymentId: 'payment-1',
        orderId: 'order-1',
        amount: 15000,
        currency: 'IRR',
      }),
    ).rejects.toThrow(BadGatewayException);
  });

  it('verifies a successful Zarinpal webhook via capture', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => ({
        data: { code: 100 },
      }),
    });

    const rawBody = JSON.stringify({
      authority: 'A00000000000000000000000000000000001',
      status: 'OK',
      amount: 15000,
      eventId: 'evt_zarinpal_1',
    });

    await expect(
      provider.verifyWebhook({
        rawBody,
      }),
    ).resolves.toEqual({
      eventId: 'evt_zarinpal_1',
      type: 'payment.succeeded',
      providerPaymentId: 'A00000000000000000000000000000000001',
      amount: 15000,
    });
  });

  it('maps failed Zarinpal webhook status without calling capture', async () => {
    const rawBody = JSON.stringify({
      authority: 'A00000000000000000000000000000000001',
      status: 'NOK',
    });

    await expect(
      provider.verifyWebhook({
        rawBody,
      }),
    ).resolves.toEqual({
      eventId: expect.stringMatching(/^zarinpal_/),
      type: 'payment.failed',
      providerPaymentId: 'A00000000000000000000000000000000001',
      amount: undefined,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
