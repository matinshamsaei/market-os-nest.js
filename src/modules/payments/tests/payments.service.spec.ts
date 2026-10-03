import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { OrderStatus, PaymentProviderType, PaymentStatus, UserRole } from '@prisma/client';

import { PrismaService } from '@/database/prisma/prisma.service';
import type { TokenPayload } from '@/shared/types';

import { OrderStateMachine } from '../../orders/helpers';
import { OrdersRepository } from '../../orders/orders.repository';
import { WalletService } from '../../wallet/wallet.service';
import { PaymentStateMachine } from '../helpers';
import { TransientPaymentError } from '../helpers';
import { PaymentProviderFactory } from '../providers/provider.factory';
import { PaymentsRepository } from '../payments.repository';
import { PaymentsService } from '../payments.service';

describe('PaymentsService', () => {
  let service: PaymentsService;

  const customer: TokenPayload = {
    userId: 'customer-1',
    email: 'customer@test.com',
    role: UserRole.CUSTOMER,
  };

  const admin: TokenPayload = {
    userId: 'admin-1',
    email: 'admin@test.com',
    role: UserRole.ADMIN,
  };

  const pendingOrder = {
    id: 'order-1',
    userId: 'customer-1',
    status: OrderStatus.PENDING,
    total: 200,
    subTotal: 200,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const processingPayment = {
    id: 'payment-1',
    orderId: 'order-1',
    provider: PaymentProviderType.FAKE,
    providerPaymentId: 'fake_provider_1',
    status: PaymentStatus.PROCESSING,
    amount: 200,
    currency: 'IRR',
    attemptCount: 1,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    order: pendingOrder,
  };

  const mockPaymentsRepository = {
    create: jest.fn(),
    update: jest.fn(),
    hasActivePayment: jest.fn(),
    findByProviderPaymentIdForUpdate: jest.fn(),
    findByIdForUpdate: jest.fn(),
    findByIdWithOrder: jest.fn(),
    findFailed: jest.fn(),
    findProcessingOlderThan: jest.fn(),
    findProcessedWebhook: jest.fn(),
    createProcessedWebhook: jest.fn(),
  };

  const mockOrdersRepository = {
    findById: jest.fn(),
    updateStatus: jest.fn(),
  };

  const mockProvider = {
    createPayment: jest.fn(),
    verifyWebhook: jest.fn(),
    getPaymentStatus: jest.fn(),
  };

  const mockProviderFactory = {
    resolveConfiguredProvider: jest.fn(),
    getProvider: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockPrismaService = {
    $transaction: jest.fn(),
  };

  const mockWalletService = {
    refund: jest.fn(),
  };

  const mockPaymentStateMachine = {
    canTransition: jest.fn(),
    assertCanTransition: jest.fn(),
  };

  const mockOrderStateMachine = {
    canTransition: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockProviderFactory.resolveConfiguredProvider.mockReturnValue(PaymentProviderType.FAKE);
    mockProviderFactory.getProvider.mockReturnValue(mockProvider);
    mockConfigService.get.mockImplementation((key: string, fallback?: string) => {
      if (key === 'PAYMENT_RECONCILE_MAX_AGE_MINUTES') {
        return fallback ?? '15';
      }

      return undefined;
    });
    mockPaymentsRepository.hasActivePayment.mockResolvedValue(false);
    mockPaymentsRepository.findProcessedWebhook.mockResolvedValue(null);
    mockProvider.createPayment.mockResolvedValue({
      providerPaymentId: 'fake_provider_1',
      paymentUrl: 'https://fake-payment.example.com/pay/fake_provider_1',
    });
    mockPaymentStateMachine.canTransition.mockReturnValue(true);
    mockPaymentStateMachine.assertCanTransition.mockReset();
    mockPaymentStateMachine.assertCanTransition.mockImplementation(() => undefined);
    mockOrderStateMachine.canTransition.mockReturnValue(true);

    mockPrismaService.$transaction.mockImplementation((callback) => {
      if (typeof callback === 'function') {
        return callback({ payment: {} });
      }

      return callback;
    });

    mockPaymentsRepository.create.mockResolvedValue({
      id: 'payment-1',
      orderId: 'order-1',
      provider: PaymentProviderType.FAKE,
      status: PaymentStatus.PENDING,
      amount: 200,
      currency: 'IRR',
      attemptCount: 1,
    });

    mockPaymentsRepository.update.mockResolvedValue({
      id: 'payment-1',
      status: PaymentStatus.PROCESSING,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PaymentsRepository, useValue: mockPaymentsRepository },
        { provide: OrdersRepository, useValue: mockOrdersRepository },
        { provide: PaymentProviderFactory, useValue: mockProviderFactory },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: PaymentStateMachine, useValue: mockPaymentStateMachine },
        { provide: OrderStateMachine, useValue: mockOrderStateMachine },
        { provide: WalletService, useValue: mockWalletService },
      ],
    }).compile();

    service = module.get(PaymentsService);
  });

  describe('createPayment', () => {
    it('creates a payment and returns redirect details', async () => {
      mockOrdersRepository.findById.mockResolvedValue(pendingOrder);

      const result = await service.createPayment(customer, { orderId: 'order-1' });

      expect(result).toEqual({
        paymentId: 'payment-1',
        paymentUrl: 'https://fake-payment.example.com/pay/fake_provider_1',
      });
      expect(mockProvider.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentId: 'payment-1',
          orderId: 'order-1',
          amount: 200,
          currency: 'IRR',
        }),
      );
      expect(mockPaymentsRepository.update).toHaveBeenCalledWith(
        expect.anything(),
        'payment-1',
        expect.objectContaining({
          providerPaymentId: 'fake_provider_1',
          status: PaymentStatus.PROCESSING,
        }),
      );
    });

    it('retries transient provider failures then succeeds', async () => {
      mockOrdersRepository.findById.mockResolvedValue(pendingOrder);
      mockProvider.createPayment
        .mockRejectedValueOnce(new TransientPaymentError('Gateway timeout'))
        .mockResolvedValueOnce({
          providerPaymentId: 'fake_provider_1',
          paymentUrl: 'https://fake-payment.example.com/pay/fake_provider_1',
        });

      await expect(service.createPayment(customer, { orderId: 'order-1' })).resolves.toEqual({
        paymentId: 'payment-1',
        paymentUrl: 'https://fake-payment.example.com/pay/fake_provider_1',
      });
      expect(mockProvider.createPayment).toHaveBeenCalledTimes(2);
    });

    it('marks payment failed after exhausted retries', async () => {
      mockOrdersRepository.findById.mockResolvedValue(pendingOrder);
      mockProvider.createPayment.mockRejectedValue(new TransientPaymentError('Gateway timeout'));

      await expect(service.createPayment(customer, { orderId: 'order-1' })).rejects.toThrow(
        TransientPaymentError,
      );
      expect(mockPaymentsRepository.update).toHaveBeenCalledWith(
        expect.anything(),
        'payment-1',
        expect.objectContaining({
          status: PaymentStatus.FAILED,
          lastError: 'Gateway timeout',
        }),
      );
    });

    it('throws when order is not found', async () => {
      mockOrdersRepository.findById.mockResolvedValue(null);

      await expect(service.createPayment(customer, { orderId: 'missing' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws when customer does not own the order', async () => {
      mockOrdersRepository.findById.mockResolvedValue({
        ...pendingOrder,
        userId: 'other-customer',
      });

      await expect(service.createPayment(customer, { orderId: 'order-1' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws when order is not pending', async () => {
      mockOrdersRepository.findById.mockResolvedValue({
        ...pendingOrder,
        status: OrderStatus.PAID,
      });

      await expect(service.createPayment(customer, { orderId: 'order-1' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws when order already has an active payment', async () => {
      mockOrdersRepository.findById.mockResolvedValue(pendingOrder);
      mockPaymentsRepository.hasActivePayment.mockResolvedValue(true);

      await expect(service.createPayment(customer, { orderId: 'order-1' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('handleWebhook', () => {
    const rawBody = JSON.stringify({
      eventId: 'evt_1',
      type: 'payment.succeeded',
      providerPaymentId: 'fake_provider_1',
      amount: 200,
    });

    beforeEach(() => {
      mockProvider.verifyWebhook.mockResolvedValue({
        eventId: 'evt_1',
        type: 'payment.succeeded',
        providerPaymentId: 'fake_provider_1',
        amount: 200,
      });
      mockPaymentsRepository.findByProviderPaymentIdForUpdate.mockResolvedValue(processingPayment);
      mockPaymentsRepository.update.mockResolvedValue({
        ...processingPayment,
        status: PaymentStatus.SUCCEEDED,
      });
      mockOrdersRepository.updateStatus.mockResolvedValue({
        ...pendingOrder,
        status: OrderStatus.PAID,
      });
    });

    it('marks payment succeeded and order paid', async () => {
      const result = await service.handleWebhook(rawBody, 'signature', 'FAKE');

      expect(result).toEqual({
        received: true,
        paymentId: 'payment-1',
        status: PaymentStatus.SUCCEEDED,
      });
      expect(mockPaymentsRepository.createProcessedWebhook).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          provider: PaymentProviderType.FAKE,
          eventId: 'evt_1',
          paymentId: 'payment-1',
        }),
      );
      expect(mockOrdersRepository.updateStatus).toHaveBeenCalledWith(
        expect.anything(),
        'order-1',
        OrderStatus.PAID,
      );
    });

    it('is idempotent for duplicate event ids', async () => {
      mockPaymentsRepository.findProcessedWebhook.mockResolvedValue({
        id: 'processed-1',
        provider: PaymentProviderType.FAKE,
        eventId: 'evt_1',
        paymentId: 'payment-1',
      });
      mockPaymentsRepository.findByIdForUpdate.mockResolvedValue({
        ...processingPayment,
        status: PaymentStatus.SUCCEEDED,
        order: { ...pendingOrder, status: OrderStatus.PAID },
      });

      const result = await service.handleWebhook(rawBody, 'signature', 'FAKE');

      expect(result).toEqual({
        received: true,
        paymentId: 'payment-1',
        status: PaymentStatus.SUCCEEDED,
      });
      expect(mockPaymentsRepository.update).not.toHaveBeenCalled();
      expect(mockOrdersRepository.updateStatus).not.toHaveBeenCalled();
      expect(mockWalletService.refund).not.toHaveBeenCalled();
    });

    it('marks payment failed without updating the order', async () => {
      mockProvider.verifyWebhook.mockResolvedValue({
        eventId: 'evt_2',
        type: 'payment.failed',
        providerPaymentId: 'fake_provider_1',
      });
      mockPaymentsRepository.update.mockResolvedValue({
        ...processingPayment,
        status: PaymentStatus.FAILED,
      });

      const result = await service.handleWebhook(rawBody, 'signature', 'FAKE');

      expect(result.status).toBe(PaymentStatus.FAILED);
      expect(mockOrdersRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('refunds wallet when payment is refunded', async () => {
      mockProvider.verifyWebhook.mockResolvedValue({
        eventId: 'evt_3',
        type: 'payment.refunded',
        providerPaymentId: 'fake_provider_1',
        amount: 200,
      });
      mockPaymentsRepository.findByProviderPaymentIdForUpdate.mockResolvedValue({
        ...processingPayment,
        status: PaymentStatus.SUCCEEDED,
        order: { ...pendingOrder, status: OrderStatus.PAID },
      });
      mockPaymentsRepository.update.mockResolvedValue({
        ...processingPayment,
        status: PaymentStatus.REFUNDED,
      });

      await service.handleWebhook(rawBody, 'signature', 'FAKE');

      expect(mockWalletService.refund).toHaveBeenCalledWith('customer-1', 200, expect.anything());
    });

    it('rejects invalid provider hints', async () => {
      await expect(service.handleWebhook(rawBody, 'signature', 'UNKNOWN')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects illegal payment transitions', async () => {
      mockPaymentStateMachine.assertCanTransition.mockImplementation(() => {
        throw new BadRequestException('illegal');
      });

      await expect(service.handleWebhook(rawBody, 'signature', 'FAKE')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws when payment is missing', async () => {
      mockPaymentsRepository.findByProviderPaymentIdForUpdate.mockResolvedValue(null);

      await expect(service.handleWebhook(rawBody, 'signature', 'FAKE')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('admin retry and reconciliation', () => {
    it('lists failed payments for admins', async () => {
      mockPaymentsRepository.findFailed.mockResolvedValue([processingPayment]);

      await expect(service.listFailedPayments(admin)).resolves.toEqual([processingPayment]);
    });

    it('forbids customers from listing failed payments', async () => {
      await expect(service.listFailedPayments(customer)).rejects.toThrow(
        'Only admins can monitor failed payments',
      );
    });

    it('retries a failed payment for admins', async () => {
      mockPaymentsRepository.findByIdWithOrder.mockResolvedValue({
        ...processingPayment,
        status: PaymentStatus.FAILED,
      });
      mockPaymentsRepository.create.mockResolvedValue({
        id: 'payment-2',
        orderId: 'order-1',
        provider: PaymentProviderType.FAKE,
        status: PaymentStatus.PENDING,
        amount: 200,
        currency: 'IRR',
        attemptCount: 2,
      });
      mockProvider.createPayment.mockResolvedValue({
        providerPaymentId: 'fake_provider_2',
        paymentUrl: 'https://fake-payment.example.com/pay/fake_provider_2',
      });

      await expect(service.retryFailedPayment('payment-1', admin)).resolves.toEqual({
        paymentId: 'payment-2',
        paymentUrl: 'https://fake-payment.example.com/pay/fake_provider_2',
      });
      expect(mockPaymentsRepository.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ attemptCount: 2 }),
      );
    });

    it('repairs stale processing payments during reconciliation', async () => {
      mockPaymentsRepository.findProcessingOlderThan.mockResolvedValue([processingPayment]);
      mockProvider.getPaymentStatus.mockResolvedValue({ status: 'SUCCEEDED' });
      mockPaymentsRepository.findByIdForUpdate.mockResolvedValue(processingPayment);
      mockPaymentsRepository.update.mockResolvedValue({
        ...processingPayment,
        status: PaymentStatus.SUCCEEDED,
      });

      await expect(service.reconcileStalePayments()).resolves.toEqual({
        checked: 1,
        repaired: 1,
      });
      expect(mockOrdersRepository.updateStatus).toHaveBeenCalledWith(
        expect.anything(),
        'order-1',
        OrderStatus.PAID,
      );
    });
  });
});
