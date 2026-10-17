import { Injectable } from '@nestjs/common';

import {
  Notification,
  NotificationChannel,
  NotificationStatus,
  NotificationType,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '@/database/prisma/prisma.service';
import { paginate, type PaginatedResult } from '@/shared/pagination';

import { GetNotificationsQueryDto } from './dto';

export type CreateNotificationData = {
  userId: string;
  type: NotificationType;
  channel: NotificationChannel;
  title: string;
  message: string;
  status?: NotificationStatus;
  eventId?: string;
};

@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findForUser(
    userId: string,
    query: GetNotificationsQueryDto,
  ): Promise<PaginatedResult<Notification>> {
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.channel ? { channel: query.channel } : {}),
    };

    return paginate(this.prisma.notification, {
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      page: query.page,
      perPage: query.perPage,
    });
  }

  countUnread(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, readAt: null },
    });
  }

  findByIdForUser(id: string, userId: string): Promise<Notification | null> {
    return this.prisma.notification.findFirst({
      where: { id, userId },
    });
  }

  async markReadIfUnread(id: string, userId: string, readAt: Date): Promise<Notification | null> {
    const updated = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt },
    });

    if (updated.count === 0) {
      return null;
    }

    return this.findByIdForUser(id, userId);
  }

  markAllRead(userId: string, readAt: Date): Promise<number> {
    return this.prisma.notification
      .updateMany({
        where: { userId, readAt: null },
        data: { readAt },
      })
      .then((result) => result.count);
  }

  findByEventId(eventId: string): Promise<Notification | null> {
    return this.prisma.notification.findUnique({
      where: { eventId },
    });
  }

  async create(
    data: CreateNotificationData,
    transaction?: Prisma.TransactionClient,
  ): Promise<Notification> {
    const repository = transaction ?? this.prisma;

    try {
      return await repository.notification.create({
        data: {
          userId: data.userId,
          type: data.type,
          channel: data.channel,
          title: data.title,
          message: data.message,
          status: data.status ?? NotificationStatus.PENDING,
          eventId: data.eventId,
        },
      });
    } catch (error) {
      if (data.eventId && this.isUniqueViolation(error)) {
        const existing = await this.findByEventId(data.eventId);

        if (existing) {
          return existing;
        }
      }

      throw error;
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
