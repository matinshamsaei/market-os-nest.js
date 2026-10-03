import { Injectable } from '@nestjs/common';

import { Order, Payment, PaymentProviderType, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@/database/prisma/prisma.service';

type PaymentWithOrder = Payment & { order: Order };

@Injectable()
export class PaymentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(transaction: Prisma.TransactionClient, data: Prisma.PaymentCreateInput): Promise<Payment> {
    return transaction.payment.create({ data });
  }

  findById(id: string): Promise<Payment | null> {
    return this.prisma.payment.findUnique({ where: { id } });
  }

  findByIdWithOrder(id: string): Promise<PaymentWithOrder | null> {
    return this.prisma.payment.findUnique({
      where: { id },
      include: { order: true },
    });
  }

  findByIdForUpdate(
    transaction: Prisma.TransactionClient,
    id: string,
  ): Promise<PaymentWithOrder | null> {
    return transaction.payment.findUnique({
      where: { id },
      include: { order: true },
    });
  }

  update(
    transaction: Prisma.TransactionClient,
    id: string,
    data: Prisma.PaymentUpdateInput,
  ): Promise<Payment> {
    return transaction.payment.update({ where: { id }, data });
  }

  findByProviderPaymentId(providerPaymentId: string): Promise<Payment | null> {
    return this.prisma.payment.findFirst({
      where: { providerPaymentId },
    });
  }

  findByProviderPaymentIdForUpdate(
    transaction: Prisma.TransactionClient,
    providerPaymentId: string,
  ): Promise<PaymentWithOrder | null> {
    return transaction.payment.findFirst({
      where: { providerPaymentId },
      include: { order: true },
    });
  }

  findFailed(): Promise<Payment[]> {
    return this.prisma.payment.findMany({
      where: { status: PaymentStatus.FAILED },
      orderBy: { createdAt: 'desc' },
    });
  }

  findProcessingOlderThan(cutoff: Date): Promise<PaymentWithOrder[]> {
    return this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.PROCESSING,
        updatedAt: { lte: cutoff },
        providerPaymentId: { not: null },
      },
      include: { order: true },
      orderBy: { updatedAt: 'asc' },
    });
  }

  async hasActivePayment(orderId: string): Promise<boolean> {
    return this.prisma.payment
      .findFirst({
        where: {
          orderId,
          status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING] },
        },
      })
      .then((payment) => payment !== null);
  }

  findProcessedWebhook(
    transaction: Prisma.TransactionClient,
    provider: PaymentProviderType,
    eventId: string,
  ) {
    return transaction.processedPaymentWebhook.findUnique({
      where: {
        provider_eventId: { provider, eventId },
      },
    });
  }

  createProcessedWebhook(
    transaction: Prisma.TransactionClient,
    data: {
      provider: PaymentProviderType;
      eventId: string;
      paymentId: string;
    },
  ) {
    return transaction.processedPaymentWebhook.create({ data });
  }
}
