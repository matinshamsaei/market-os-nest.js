import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';

import type { TokenPayload } from '@/shared/types';

import { NotificationsController } from '../notifications.controller';
import { NotificationsService } from '../notifications.service';

describe('NotificationsController', () => {
  let controller: NotificationsController;

  const mockNotificationsService = {
    getNotifications: jest.fn(),
    getUnreadCount: jest.fn(),
    markAsRead: jest.fn(),
    markAllAsRead: jest.fn(),
  };

  const customer: TokenPayload = {
    userId: 'customer-1',
    email: 'customer@test.com',
    role: UserRole.CUSTOMER,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        {
          provide: NotificationsService,
          useValue: mockNotificationsService,
        },
      ],
    }).compile();

    controller = module.get<NotificationsController>(NotificationsController);
    jest.clearAllMocks();
  });

  describe('getNotifications', () => {
    it('delegates to notificationsService.getNotifications', async () => {
      const query = { page: 1, perPage: 10 };
      const paginated = {
        data: [],
        meta: { page: 1, perPage: 10, total: 0, totalPages: 0 },
      };

      mockNotificationsService.getNotifications.mockResolvedValue(paginated);

      await expect(controller.getNotifications(customer, query)).resolves.toEqual(paginated);
      expect(mockNotificationsService.getNotifications).toHaveBeenCalledWith(customer, query);
    });
  });

  describe('getUnreadCount', () => {
    it('delegates to notificationsService.getUnreadCount', async () => {
      mockNotificationsService.getUnreadCount.mockResolvedValue({ count: 2 });

      await expect(controller.getUnreadCount(customer)).resolves.toEqual({ count: 2 });
      expect(mockNotificationsService.getUnreadCount).toHaveBeenCalledWith(customer);
    });
  });

  describe('markAsRead', () => {
    it('delegates to notificationsService.markAsRead', async () => {
      const notification = { id: 'notification-1', readAt: new Date() };
      mockNotificationsService.markAsRead.mockResolvedValue(notification);

      await expect(controller.markAsRead(notification.id, customer)).resolves.toEqual(notification);
      expect(mockNotificationsService.markAsRead).toHaveBeenCalledWith(notification.id, customer);
    });
  });

  describe('markAllAsRead', () => {
    it('delegates to notificationsService.markAllAsRead', async () => {
      mockNotificationsService.markAllAsRead.mockResolvedValue({ updatedCount: 3 });

      await expect(controller.markAllAsRead(customer)).resolves.toEqual({ updatedCount: 3 });
      expect(mockNotificationsService.markAllAsRead).toHaveBeenCalledWith(customer);
    });
  });
});
