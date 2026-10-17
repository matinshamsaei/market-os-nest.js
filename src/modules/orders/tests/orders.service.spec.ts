import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { OrderStatus, UserRole } from '@prisma/client';

import { PrismaService } from '@/database/prisma/prisma.service';
import type { TokenPayload } from '@/shared/types';

import { CartService } from '../../cart/cart.service';
import { InventoryService } from '../../inventory/inventory.service';
import { WalletService } from '../../wallet/wallet.service';
import { OrderStateMachine } from '../helpers';
import { OrdersRepository } from '../orders.repository';
import { OrdersService } from '../orders.service';

describe('OrdersService', () => {
  let service: OrdersService;

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

  const mockTransaction = {};

  const mockOrdersRepository = {
    createOrder: jest.fn(),
    findById: jest.fn(),
    findByIdWithItems: jest.fn(),
    findMany: jest.fn(),
    findManyForVendor: jest.fn(),
    updateStatus: jest.fn(),
  };

  const mockInventoryService = {
    decrementProductStock: jest.fn(),
    restoreProductStock: jest.fn(),
  };

  const mockCartService = {
    getCart: jest.fn(),
    clearCart: jest.fn(),
  };

  const mockWalletService = {
    pay: jest.fn(),
    refund: jest.fn(),
  };

  const mockPrismaService = {
    $transaction: jest.fn(),
  };

  const mockStateMachine = {
    canTransition: jest.fn(),
  };

  const cart = {
    items: [
      {
        id: 'item-1',
        productId: 'product-1',
        quantity: 2,
        title: 'Phone',
        price: 100,
        lineTotal: 200,
      },
    ],
    subtotal: 200,
    totalItems: 2,
  };

  const paidOrder = {
    id: 'order-1',
    userId: customer.userId,
    status: OrderStatus.PAID,
    total: 200,
    subTotal: 200,
    createdAt: new Date(),
    updatedAt: new Date(),
    orderItems: [
      {
        id: 'order-item-1',
        orderId: 'order-1',
        productId: 'product-1',
        productTitleSnapshot: 'Phone',
        productPriceSnapshot: 100,
        quantity: 2,
      },
    ],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: OrdersRepository, useValue: mockOrdersRepository },
        { provide: InventoryService, useValue: mockInventoryService },
        { provide: CartService, useValue: mockCartService },
        { provide: WalletService, useValue: mockWalletService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: OrderStateMachine, useValue: mockStateMachine },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
    jest.clearAllMocks();

    mockPrismaService.$transaction.mockImplementation(
      async (callback: (tx: typeof mockTransaction) => Promise<unknown>) =>
        callback(mockTransaction),
    );
  });

  describe('checkout', () => {
    it('pays with wallet and creates a PAID order inside one transaction', async () => {
      mockCartService.getCart.mockResolvedValue(cart);
      mockInventoryService.decrementProductStock.mockResolvedValue(undefined);
      mockWalletService.pay.mockResolvedValue({ id: 'payment-1' });
      mockOrdersRepository.createOrder.mockResolvedValue(paidOrder);
      mockCartService.clearCart.mockResolvedValue({ items: [], subtotal: 0, totalItems: 0 });

      const order = await service.checkout(customer);

      expect(mockInventoryService.decrementProductStock).toHaveBeenCalledWith(
        mockTransaction,
        'product-1',
        2,
      );
      expect(mockWalletService.pay).toHaveBeenCalledWith(customer.userId, 200, mockTransaction);
      expect(mockOrdersRepository.createOrder).toHaveBeenCalledWith(
        mockTransaction,
        expect.objectContaining({
          status: OrderStatus.PAID,
          total: 200,
          subTotal: 200,
        }),
      );
      expect(mockCartService.clearCart).toHaveBeenCalledWith(customer, mockTransaction);
      expect(order).toEqual(paidOrder);
    });

    it('throws when the cart is empty', async () => {
      mockCartService.getCart.mockResolvedValue({ items: [], subtotal: 0, totalItems: 0 });

      await expect(service.checkout(customer)).rejects.toThrow(BadRequestException);
      await expect(service.checkout(customer)).rejects.toThrow('Cart is empty');
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('propagates insufficient wallet balance failures', async () => {
      mockCartService.getCart.mockResolvedValue(cart);
      mockWalletService.pay.mockRejectedValue(
        new BadRequestException('Insufficient wallet balance'),
      );

      await expect(service.checkout(customer)).rejects.toThrow(BadRequestException);
      expect(mockOrdersRepository.createOrder).not.toHaveBeenCalled();
    });
  });

  describe('refundOrder', () => {
    it('refunds wallet, restores stock, and cancels the order', async () => {
      mockOrdersRepository.findByIdWithItems.mockResolvedValue(paidOrder);
      mockStateMachine.canTransition.mockReturnValue(true);
      mockWalletService.refund.mockResolvedValue({ id: 'refund-1' });
      mockInventoryService.restoreProductStock.mockResolvedValue(undefined);
      mockOrdersRepository.updateStatus.mockResolvedValue({
        ...paidOrder,
        status: OrderStatus.CANCELLED,
      });

      const order = await service.refundOrder(paidOrder.id, admin);

      expect(mockWalletService.refund).toHaveBeenCalledWith(customer.userId, 200, mockTransaction);
      expect(mockInventoryService.restoreProductStock).toHaveBeenCalledWith(
        mockTransaction,
        'product-1',
        2,
      );
      expect(mockOrdersRepository.updateStatus).toHaveBeenCalledWith(
        mockTransaction,
        paidOrder.id,
        OrderStatus.CANCELLED,
      );
      expect(order.status).toBe(OrderStatus.CANCELLED);
    });

    it('rejects non-admin users', async () => {
      await expect(service.refundOrder(paidOrder.id, customer)).rejects.toThrow(ForbiddenException);
    });

    it('allows a customer to cancel a PAID order with wallet refund', async () => {
      mockOrdersRepository.findByIdWithItems.mockResolvedValue(paidOrder);
      mockStateMachine.canTransition.mockReturnValue(true);
      mockWalletService.refund.mockResolvedValue({ id: 'refund-1' });
      mockInventoryService.restoreProductStock.mockResolvedValue(undefined);
      mockOrdersRepository.updateStatus.mockResolvedValue({
        ...paidOrder,
        status: OrderStatus.CANCELLED,
      });

      const order = await service.cancelOrder(paidOrder.id, customer);

      expect(mockWalletService.refund).toHaveBeenCalledWith(customer.userId, 200, mockTransaction);
      expect(mockInventoryService.restoreProductStock).toHaveBeenCalledWith(
        mockTransaction,
        'product-1',
        2,
      );
      expect(order.status).toBe(OrderStatus.CANCELLED);
    });

    it('rejects customer cancel after the order has shipped', async () => {
      mockOrdersRepository.findByIdWithItems.mockResolvedValue({
        ...paidOrder,
        status: OrderStatus.SHIPPED,
      });

      await expect(service.cancelOrder(paidOrder.id, customer)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockWalletService.refund).not.toHaveBeenCalled();
    });

    it('lets admins list all vendor orders', async () => {
      mockOrdersRepository.findMany.mockResolvedValue([paidOrder]);

      await expect(service.getVendorOrders(admin)).resolves.toEqual([paidOrder]);
      expect(mockOrdersRepository.findMany).toHaveBeenCalled();
    });

    it('rejects non-refundable statuses', async () => {
      mockOrdersRepository.findByIdWithItems.mockResolvedValue({
        ...paidOrder,
        status: OrderStatus.CANCELLED,
      });

      await expect(service.refundOrder(paidOrder.id, admin)).rejects.toThrow(BadRequestException);
    });

    it('throws when order does not exist', async () => {
      mockOrdersRepository.findByIdWithItems.mockResolvedValue(null);

      await expect(service.refundOrder('missing', admin)).rejects.toThrow(NotFoundException);
    });
  });
});
