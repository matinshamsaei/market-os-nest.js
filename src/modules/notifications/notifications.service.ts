import { Injectable, NotFoundException } from '@nestjs/common';

import { Notification } from '@prisma/client';

import type { PaginatedResult } from '@/shared/pagination';
import type { TokenPayload } from '@/shared/types';

import { GetNotificationsQueryDto } from './dto';
import { CreateNotificationData, NotificationsRepository } from './notifications.repository';

@Injectable()
export class NotificationsService {
  constructor(private readonly notificationsRepository: NotificationsRepository) {}

  getNotifications(
    user: TokenPayload,
    query: GetNotificationsQueryDto,
  ): Promise<PaginatedResult<Notification>> {
    return this.notificationsRepository.findForUser(user.userId, query);
  }

  async getUnreadCount(user: TokenPayload): Promise<{ count: number }> {
    const count = await this.notificationsRepository.countUnread(user.userId);
    return { count };
  }

  async markAsRead(id: string, user: TokenPayload): Promise<Notification> {
    const notification = await this.notificationsRepository.findByIdForUser(id, user.userId);

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.readAt) {
      return notification;
    }

    const updated = await this.notificationsRepository.markReadIfUnread(
      id,
      user.userId,
      new Date(),
    );

    return updated ?? notification;
  }

  async markAllAsRead(user: TokenPayload): Promise<{ updatedCount: number }> {
    const updatedCount = await this.notificationsRepository.markAllRead(user.userId, new Date());
    return { updatedCount };
  }

  create(data: CreateNotificationData): Promise<Notification> {
    return this.notificationsRepository.create(data);
  }
}
