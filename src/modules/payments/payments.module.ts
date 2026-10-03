import { Module } from '@nestjs/common';

import { PrismaModule } from '@/database/prisma/prisma.module';

import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { WalletModule } from '../wallet/wallet.module';

import { PaymentsController } from './payments.controller';
import { PaymentStateMachine } from './helpers';
import { PaymentsReconciliationJob } from './jobs/payments-reconciliation.job';
import {
  FakeProvider,
  PaymentProviderFactory,
  StripeProvider,
  ZarinpalProvider,
} from './providers';
import { PaymentsRepository } from './payments.repository';
import { PaymentsService } from './payments.service';

@Module({
  imports: [AuthModule, OrdersModule, WalletModule, PrismaModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    PaymentsRepository,
    PaymentProviderFactory,
    FakeProvider,
    StripeProvider,
    ZarinpalProvider,
    PaymentStateMachine,
    PaymentsReconciliationJob,
  ],
  exports: [PaymentsService, PaymentsRepository, PaymentProviderFactory, FakeProvider],
})
export class PaymentsModule {}
