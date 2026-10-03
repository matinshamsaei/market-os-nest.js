import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentProviderType } from '@prisma/client';

import type { PaymentProvider } from './types';
import { FakeProvider } from './fake.provider';
import { StripeProvider } from './stripe.provider';
import { ZarinpalProvider } from './zarinpal.provider';

@Injectable()
export class PaymentProviderFactory {
  constructor(
    private readonly configService: ConfigService,
    private readonly fakeProvider: FakeProvider,
    private readonly stripeProvider: StripeProvider,
    private readonly zarinpalProvider: ZarinpalProvider,
  ) {}

  getProvider(provider?: PaymentProviderType): PaymentProvider {
    const configured = provider ?? this.resolveConfiguredProvider();

    switch (configured) {
      case PaymentProviderType.STRIPE:
        return this.stripeProvider;
      case PaymentProviderType.ZARINPAL:
        return this.zarinpalProvider;
      case PaymentProviderType.FAKE:
      default:
        return this.fakeProvider;
    }
  }

  resolveConfiguredProvider(): PaymentProviderType {
    const value = this.configService.get<string>('PAYMENT_PROVIDER', 'FAKE').toUpperCase();

    if (Object.values(PaymentProviderType).includes(value as PaymentProviderType)) {
      return value as PaymentProviderType;
    }

    return PaymentProviderType.FAKE;
  }
}
