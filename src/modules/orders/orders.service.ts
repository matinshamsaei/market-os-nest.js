import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Order, OrderStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '@/database/prisma/prisma.service';
import type { TokenPayload } from '@/shared/types';

import { CartService } from '../cart/cart.service';
import { CartItemResponse } from '../cart/dto';
import { InventoryService } from '../inventory/inventory.service';
import { WalletService } from '../wallet/wallet.service';

import { CUSTOMER_ORDER_CANCELLABLE_STATUSES, REFUNDABLE_STATUSES } from './constants';
import { OrdersRepository } from './orders.repository';
import { OrderStateMachine } from './helpers';

@Injectable()
export class OrdersService {
  constructor(
    private readonly ordersRepository: OrdersRepository,
    private readonly inventoryService: InventoryService,
    private readonly cartService: CartService,
    private readonly walletService: WalletService,
    private readonly prisma: PrismaService,
    private readonly stateMachine: OrderStateMachine,
  ) {}

  async checkout(user: TokenPayload, idempotencyKey?: string): Promise<Order> {
    if (idempotencyKey) {
      const cached = this.idempotencyStore.get(idempotencyKey);
      if (cached) {
        return cached;
      }
    }

    const cart = await this.cartService.getCart(user);

    if (!cart?.items?.length) {
      throw new BadRequestException('Cart is empty');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.decrementProductStock(tx, cart.items);

      const pureProductsTotalPrice = cart.items.reduce(
        (acc, item) => acc + item.price * item.quantity,
        0,
      );

      await this.walletService.pay(user.userId, pureProductsTotalPrice, tx);

      const order = await this.ordersRepository.createOrder(tx, {
        user: { connect: { id: user.userId } },
        subTotal: pureProductsTotalPrice,
        total: pureProductsTotalPrice, // TODO: add shipping price and other fees
        status: OrderStatus.PAID,
        orderItems: {
          create: cart.items.map((item) => {
            return {
              product: { connect: { id: item.productId } },
              productTitleSnapshot: item.title,
              productPriceSnapshot: item.price,
              quantity: item.quantity,
            };
          }),
        },
      });

      await this.cartService.clearCart(user, tx);

      if (idempotencyKey) {
        this.idempotencyStore.set(idempotencyKey, order);
      }

      return order;
    });
  }

  async getOrders(user: TokenPayload): Promise<Order[]> {
    if (user.role === UserRole.ADMIN) {
      return this.ordersRepository.findMany();
    }

    return this.ordersRepository.findMany(user.userId);
  }

  async getOrderById(orderId: string, user: TokenPayload): Promise<Order> {
    const order = await this.ordersRepository.findByIdWithItems(orderId);

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (user.role !== UserRole.ADMIN && user.userId !== order.userId) {
      throw new ForbiddenException('You are not allowed to view this order');
    }

    return order;
  }

  async updateStatus(orderId: string, status: OrderStatus, user: TokenPayload): Promise<Order> {
    const order = await this.ordersRepository.findById(orderId);

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    this.assertCanUpdateOrder(order, status, user);

    if (!this.stateMachine.canTransition(order.status, status)) {
      throw new BadRequestException(`Cannot change order from ${order.status} to ${status}`);
    }

    if (status === OrderStatus.CANCELLED) {
      return this.cancelOrder(orderId, user);
    }

    return this.prisma.$transaction((tx) =>
      this.ordersRepository.updateStatus(tx, orderId, status),
    );
  }

  async cancelOrder(orderId: string, user: TokenPayload): Promise<Order> {
    const order = await this.ordersRepository.findByIdWithItems(orderId);

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (user.role === UserRole.CUSTOMER && user.userId !== order.userId) {
      throw new ForbiddenException('You are not allowed to update this order');
    }

    if (user.role === UserRole.CUSTOMER && !this.isCustomerOrderCancellable(order.status)) {
      throw new BadRequestException("Customers can't cancel order with this status");
    }

    if (user.role === UserRole.ADMIN && order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Order is already cancelled');
    }

    if (!this.stateMachine.canTransition(order.status, OrderStatus.CANCELLED)) {
      throw new BadRequestException(`Cannot change order from ${order.status} to CANCELLED`);
    }

    const shouldRefundWallet = this.isRefundableStatus(order.status);

    return this.prisma.$transaction(async (tx) => {
      if (shouldRefundWallet) {
        await this.walletService.refund(order.userId, order.total, tx);
      }

      await Promise.all(
        order.orderItems.map((item) =>
          this.inventoryService.restoreProductStock(tx, item.productId, item.quantity),
        ),
      );

      return this.ordersRepository.updateStatus(tx, orderId, OrderStatus.CANCELLED);
    });
  }

  async refundOrder(orderId: string, user: TokenPayload): Promise<Order> {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can refund orders');
    }

    const order = await this.ordersRepository.findByIdWithItems(orderId);

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (!this.isRefundableStatus(order.status)) {
      throw new BadRequestException(`Cannot refund an order with status ${order.status}`);
    }

    if (!this.stateMachine.canTransition(order.status, OrderStatus.CANCELLED)) {
      throw new BadRequestException(`Cannot change order from ${order.status} to CANCELLED`);
    }

    return this.prisma.$transaction(async (tx) => {
      await this.walletService.refund(order.userId, order.total, tx);

      await Promise.all(
        order.orderItems.map((item) =>
          this.inventoryService.restoreProductStock(tx, item.productId, item.quantity),
        ),
      );

      return this.ordersRepository.updateStatus(tx, orderId, OrderStatus.CANCELLED);
    });
  }

  async getVendorOrders(user: TokenPayload): Promise<Order[]> {
    if (user.role === UserRole.VENDOR) {
      return this.ordersRepository.findManyForVendor(user.userId);
    }

    if (user.role === UserRole.ADMIN) {
      return this.ordersRepository.findMany();
    }

    throw new ForbiddenException('Only vendors and admins can view vendor orders');
  }

  private readonly idempotencyStore = new Map<string, Order>();

  private isRefundableStatus(status: OrderStatus): boolean {
    return REFUNDABLE_STATUSES.includes(status);
  }

  private isCustomerOrderCancellable(status: OrderStatus): boolean {
    return CUSTOMER_ORDER_CANCELLABLE_STATUSES.includes(status);
  }

  private assertCanUpdateOrder(order: Order, nextStatus: OrderStatus, user: TokenPayload): void {
    if (user.role === UserRole.CUSTOMER) {
      if (user.userId !== order.userId) {
        throw new ForbiddenException('You are not allowed to update this order');
      }

      if (nextStatus !== OrderStatus.CANCELLED || !this.isCustomerOrderCancellable(order.status)) {
        throw new ForbiddenException(
          'Customers can only cancel their PENDING, PAID, or PROCESSING orders',
        );
      }
    }
  }

  private async decrementProductStock(
    transaction: Prisma.TransactionClient,
    cartItems: CartItemResponse[],
  ) {
    for (const item of cartItems) {
      await this.inventoryService.decrementProductStock(transaction, item.productId, item.quantity);
    }
  }
}
