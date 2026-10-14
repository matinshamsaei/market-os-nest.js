import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  NotificationChannel,
  NotificationStatus,
  NotificationType,
  UserRole,
} from '@prisma/client';

import type { TokenPayload } from '@/shared/types';

import { NotificationsRepository } from '../notifications.repository';
import { NotificationsService } from '../notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;

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

  const unread = {
    id: 'notification-1',
    userId: customer.userId,
    type: NotificationType.ORDER_PAID,
    channel: NotificationChannel.IN_APP,
    title: 'Order paid',
    message: 'Your order has been paid.',
    status: NotificationStatus.SENT,
    readAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const mockNotificationsRepository = {
    findForUser: jest.fn(),
    countUnread: jest.fn(),
    findByIdForUser: jest.fn(),
    markReadIfUnread: jest.fn(),
    markAllRead: jest.fn(),
    create: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: NotificationsRepository,
          useValue: mockNotificationsRepository,
        },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getNotifications', () => {
    it('lists only the current user notifications', async () => {
      const query = { page: 1, perPage: 10 };
      const paginated = {
        data: [unread],
        meta: { page: 1, perPage: 10, total: 1, totalPages: 1 },
      };

      mockNotificationsRepository.findForUser.mockResolvedValue(paginated);

      await expect(service.getNotifications(customer, query)).resolves.toEqual(paginated);
      expect(mockNotificationsRepository.findForUser).toHaveBeenCalledWith(customer.userId, query);
    });

    it('scopes admin listings to the admin user', async () => {
      const query = { page: 2, perPage: 5 };
      const paginated = {
        data: [],
        meta: { page: 2, perPage: 5, total: 0, totalPages: 0 },
      };

      mockNotificationsRepository.findForUser.mockResolvedValue(paginated);

      await expect(service.getNotifications(admin, query)).resolves.toEqual(paginated);
      expect(mockNotificationsRepository.findForUser).toHaveBeenCalledWith(admin.userId, query);
    });
  });

  describe('getUnreadCount', () => {
    it('returns the unread count for the current user', async () => {
      mockNotificationsRepository.countUnread.mockResolvedValue(4);

      await expect(service.getUnreadCount(customer)).resolves.toEqual({ count: 4 });
      expect(mockNotificationsRepository.countUnread).toHaveBeenCalledWith(customer.userId);
    });
  });

  describe('markAsRead', () => {
    it('marks an unread notification as read', async () => {
      const readAt = new Date('2026-02-01T00:00:00.000Z');
      const read = { ...unread, readAt };

      jest.useFakeTimers().setSystemTime(readAt);
      mockNotificationsRepository.findByIdForUser.mockResolvedValue(unread);
      mockNotificationsRepository.markReadIfUnread.mockResolvedValue(read);

      await expect(service.markAsRead(unread.id, customer)).resolves.toEqual(read);
      expect(mockNotificationsRepository.markReadIfUnread).toHaveBeenCalledWith(
        unread.id,
        customer.userId,
        readAt,
      );

      jest.useRealTimers();
    });

    it('returns an already-read notification without writing again', async () => {
      const read = { ...unread, readAt: new Date('2026-01-02T00:00:00.000Z') };
      mockNotificationsRepository.findByIdForUser.mockResolvedValue(read);

      await expect(service.markAsRead(unread.id, customer)).resolves.toEqual(read);
      expect(mockNotificationsRepository.markReadIfUnread).not.toHaveBeenCalled();
    });

    it('hides notifications that belong to another user', async () => {
      mockNotificationsRepository.findByIdForUser.mockResolvedValue(null);

      await expect(service.markAsRead(unread.id, admin)).rejects.toThrow(NotFoundException);
      expect(mockNotificationsRepository.findByIdForUser).toHaveBeenCalledWith(
        unread.id,
        admin.userId,
      );
    });
  });

  describe('markAllAsRead', () => {
    it('marks every unread notification for the current user', async () => {
      const readAt = new Date('2026-02-01T00:00:00.000Z');

      jest.useFakeTimers().setSystemTime(readAt);
      mockNotificationsRepository.markAllRead.mockResolvedValue(3);

      await expect(service.markAllAsRead(customer)).resolves.toEqual({ updatedCount: 3 });
      expect(mockNotificationsRepository.markAllRead).toHaveBeenCalledWith(customer.userId, readAt);

      jest.useRealTimers();
    });

    it('is a no-op when nothing is unread', async () => {
      mockNotificationsRepository.markAllRead.mockResolvedValue(0);

      await expect(service.markAllAsRead(customer)).resolves.toEqual({ updatedCount: 0 });
    });
  });
});
