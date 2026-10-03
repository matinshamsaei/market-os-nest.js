import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Order,
  OrderStatus,
  Payment,
  PaymentProviderType,
  PaymentStatus,
  Prisma,
  UserRole,
} from '@prisma/client';

import { PrismaService } from '@/database/prisma/prisma.service';
import type { TokenPayload } from '@/shared/types';

import { OrderStateMachine } from '../orders/helpers';
import { OrdersRepository } from '../orders/orders.repository';
import { WalletService } from '../wallet/wallet.service';
import { CreatePaymentDto, CreatePaymentResponseDto, WebhookResponseDto } from './dto';
import { PaymentRetryPolicy, PaymentStateMachine } from './helpers';
import { PaymentProviderFactory } from './providers';
import type { PaymentWebhookEvent, ProviderPaymentStatus } from './providers';
import { PaymentsRepository } from './payments.repository';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly retryPolicy = new PaymentRetryPolicy({ maxAttempts: 3, baseDelayMs: 50 });

  constructor(
    private readonly paymentsRepository: PaymentsRepository,
    private readonly ordersRepository: OrdersRepository,
    private readonly providerFactory: PaymentProviderFactory,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly paymentStateMachine: PaymentStateMachine,
    private readonly orderStateMachine: OrderStateMachine,
    private readonly walletService: WalletService,
  ) {}

  async createPayment(
    user: TokenPayload,
    dto: CreatePaymentDto,
  ): Promise<CreatePaymentResponseDto> {
    const order = await this.ordersRepository.findById(dto.orderId);

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.userId !== user.userId) {
      throw new ForbiddenException('You are not allowed to pay for this order');
    }

    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException('Only pending orders can be paid');
    }

    const hasActivePayment = await this.paymentsRepository.hasActivePayment(order.id);

    if (hasActivePayment) {
      throw new BadRequestException('This order already has an active payment attempt');
    }

    return this.startProviderPayment(order.id, order.total);
  }

  async handleWebhook(
    rawBody: string,
    signature: string | undefined,
    providerHint?: string,
  ): Promise<WebhookResponseDto> {
    const providerType = this.resolveWebhookProvider(providerHint);
    const provider = this.providerFactory.getProvider(providerType);
    const event = await provider.verifyWebhook({
      rawBody,
      signature,
      providerHint: providerType,
    });

    return this.prisma.$transaction(async (tx) => {
      const existingEvent = await this.paymentsRepository.findProcessedWebhook(
        tx,
        providerType,
        event.eventId,
      );

      if (existingEvent) {
        const payment = existingEvent.paymentId
          ? await this.paymentsRepository.findByIdForUpdate(tx, existingEvent.paymentId)
          : await this.paymentsRepository.findByProviderPaymentIdForUpdate(
              tx,
              event.providerPaymentId,
            );

        return {
          received: true,
          paymentId: payment?.id,
          status: payment?.status,
        };
      }

      const payment = await this.paymentsRepository.findByProviderPaymentIdForUpdate(
        tx,
        event.providerPaymentId,
      );

      if (!payment) {
        throw new NotFoundException('Payment not found for webhook event');
      }

      if (payment.provider !== providerType) {
        throw new BadRequestException('Webhook provider does not match payment provider');
      }

      const nextStatus = this.mapEventToStatus(event.type);
      const updatedPayment = await this.applyStatusTransition(tx, payment, nextStatus);

      await this.paymentsRepository.createProcessedWebhook(tx, {
        provider: providerType,
        eventId: event.eventId,
        paymentId: updatedPayment.id,
      });

      return {
        received: true,
        paymentId: updatedPayment.id,
        status: updatedPayment.status,
      };
    });
  }

  async listFailedPayments(user: TokenPayload): Promise<Payment[]> {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can monitor failed payments');
    }

    return this.paymentsRepository.findFailed();
  }

  async retryFailedPayment(
    paymentId: string,
    user: TokenPayload,
  ): Promise<CreatePaymentResponseDto> {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can retry failed payments');
    }

    const payment = await this.paymentsRepository.findByIdWithOrder(paymentId);

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.status !== PaymentStatus.FAILED) {
      throw new BadRequestException('Only failed payments can be retried');
    }

    if (payment.order.status !== OrderStatus.PENDING) {
      throw new BadRequestException('Order is not pending; cannot retry payment');
    }

    const hasActivePayment = await this.paymentsRepository.hasActivePayment(payment.orderId);

    if (hasActivePayment) {
      throw new BadRequestException('This order already has an active payment attempt');
    }

    return this.startProviderPayment(payment.orderId, payment.amount, payment.attemptCount + 1);
  }

  async reconcileStalePayments(): Promise<{ checked: number; repaired: number }> {
    const maxAgeMinutes = Number(this.configService.get('PAYMENT_RECONCILE_MAX_AGE_MINUTES', '15'));
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000);
    const payments = await this.paymentsRepository.findProcessingOlderThan(cutoff);

    let repaired = 0;

    for (const payment of payments) {
      if (!payment.providerPaymentId) {
        continue;
      }

      try {
        const provider = this.providerFactory.getProvider(payment.provider);
        const remote = await provider.getPaymentStatus({
          providerPaymentId: payment.providerPaymentId,
          amount: payment.amount,
        });

        const nextStatus = this.mapProviderStatus(remote.status);

        if (!nextStatus || nextStatus === payment.status) {
          continue;
        }

        await this.prisma.$transaction(async (tx) => {
          const locked = await this.paymentsRepository.findByIdForUpdate(tx, payment.id);

          if (!locked || locked.status !== PaymentStatus.PROCESSING) {
            return;
          }

          await this.applyStatusTransition(tx, locked, nextStatus);
        });

        repaired += 1;
      } catch (error) {
        this.logger.warn(
          `Reconciliation failed for payment ${payment.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return { checked: payments.length, repaired };
  }

  private async startProviderPayment(
    orderId: string,
    amount: number,
    attemptCount = 1,
  ): Promise<CreatePaymentResponseDto> {
    const providerType = this.providerFactory.resolveConfiguredProvider();
    const provider = this.providerFactory.getProvider(providerType);
    const callbackUrl = this.configService.get<string>('PAYMENT_CALLBACK_URL');

    const payment = await this.prisma.$transaction((tx) =>
      this.paymentsRepository.create(tx, {
        order: { connect: { id: orderId } },
        provider: providerType,
        amount,
        currency: 'IRR',
        status: PaymentStatus.PENDING,
        attemptCount,
      }),
    );

    try {
      const result = await this.retryPolicy.execute(() =>
        provider.createPayment({
          paymentId: payment.id,
          orderId,
          amount,
          currency: 'IRR',
          callbackUrl,
        }),
      );

      this.paymentStateMachine.assertCanTransition(PaymentStatus.PENDING, PaymentStatus.PROCESSING);

      await this.prisma.$transaction((tx) =>
        this.paymentsRepository.update(tx, payment.id, {
          providerPaymentId: result.providerPaymentId,
          status: PaymentStatus.PROCESSING,
          lastError: null,
        }),
      );

      return {
        paymentId: payment.id,
        paymentUrl: result.paymentUrl,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Payment provider error';

      this.paymentStateMachine.assertCanTransition(PaymentStatus.PENDING, PaymentStatus.FAILED);

      await this.prisma.$transaction((tx) =>
        this.paymentsRepository.update(tx, payment.id, {
          status: PaymentStatus.FAILED,
          lastError: message,
        }),
      );

      throw error;
    }
  }

  private async applyStatusTransition(
    tx: Prisma.TransactionClient,
    payment: Payment & { order: Order },
    nextStatus: PaymentStatus,
  ): Promise<Payment> {
    if (payment.status === nextStatus) {
      return payment;
    }

    this.paymentStateMachine.assertCanTransition(payment.status, nextStatus);

    const updatedPayment = await this.paymentsRepository.update(tx, payment.id, {
      status: nextStatus,
    });

    if (nextStatus === PaymentStatus.SUCCEEDED) {
      await this.markOrderPaid(tx, payment);
    }

    if (nextStatus === PaymentStatus.REFUNDED) {
      await this.walletService.refund(payment.order.userId, payment.amount, tx);
    }

    return updatedPayment;
  }

  private resolveWebhookProvider(providerHint?: string): PaymentProviderType {
    if (!providerHint) {
      return this.providerFactory.resolveConfiguredProvider();
    }

    const normalized = providerHint.toUpperCase();

    if (!Object.values(PaymentProviderType).includes(normalized as PaymentProviderType)) {
      throw new UnauthorizedException('Unknown payment provider');
    }

    return normalized as PaymentProviderType;
  }

  private mapEventToStatus(type: PaymentWebhookEvent['type']): PaymentStatus {
    switch (type) {
      case 'payment.succeeded':
        return PaymentStatus.SUCCEEDED;
      case 'payment.failed':
        return PaymentStatus.FAILED;
      case 'payment.cancelled':
        return PaymentStatus.CANCELLED;
      case 'payment.refunded':
        return PaymentStatus.REFUNDED;
      default: {
        throw new BadRequestException(`Unsupported webhook event type: ${String(type)}`);
      }
    }
  }

  private mapProviderStatus(status: ProviderPaymentStatus): PaymentStatus | null {
    switch (status) {
      case 'SUCCEEDED':
        return PaymentStatus.SUCCEEDED;
      case 'FAILED':
        return PaymentStatus.FAILED;
      case 'CANCELLED':
        return PaymentStatus.CANCELLED;
      case 'REFUNDED':
        return PaymentStatus.REFUNDED;
      case 'PENDING':
      case 'PROCESSING':
        return null;
      default:
        return null;
    }
  }

  private async markOrderPaid(
    tx: Prisma.TransactionClient,
    payment: Payment & { order: Order },
  ): Promise<void> {
    if (payment.order.status === OrderStatus.PAID) {
      return;
    }

    if (!this.orderStateMachine.canTransition(payment.order.status, OrderStatus.PAID)) {
      throw new BadRequestException(
        `Cannot change order from ${payment.order.status} to ${OrderStatus.PAID}`,
      );
    }

    await this.ordersRepository.updateStatus(tx, payment.order.id, OrderStatus.PAID);
  }
}
