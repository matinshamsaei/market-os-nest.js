import { Injectable } from '@nestjs/common';

import {
  NotificationChannel,
  NotificationPreference,
  NotificationType,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '@/database/prisma/prisma.service';

export type PreferenceUpdate = {
  notificationType: NotificationType;
  channel: NotificationChannel;
  enabled: boolean;
};

@Injectable()
export class NotificationPreferencesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findForUser(userId: string): Promise<NotificationPreference[]> {
    return this.prisma.notificationPreference.findMany({
      where: { userId },
      orderBy: [{ notificationType: 'asc' }, { channel: 'asc' }],
    });
  }

  findOne(
    userId: string,
    notificationType: NotificationType,
    channel: NotificationChannel,
  ): Promise<NotificationPreference | null> {
    return this.prisma.notificationPreference.findUnique({
      where: {
        userId_notificationType_channel: { userId, notificationType, channel },
      },
    });
  }

  upsert(userId: string, preference: PreferenceUpdate): Promise<NotificationPreference> {
    return this.prisma.notificationPreference.upsert({
      where: {
        userId_notificationType_channel: {
          userId,
          notificationType: preference.notificationType,
          channel: preference.channel,
        },
      },
      create: {
        userId,
        notificationType: preference.notificationType,
        channel: preference.channel,
        enabled: preference.enabled,
      },
      update: { enabled: preference.enabled },
    });
  }

  upsertMany(
    userId: string,
    preferences: PreferenceUpdate[],
    transaction?: Prisma.TransactionClient,
  ): Promise<NotificationPreference[]> {
    const repository = transaction ?? this.prisma;

    return Promise.all(
      preferences.map((preference) =>
        repository.notificationPreference.upsert({
          where: {
            userId_notificationType_channel: {
              userId,
              notificationType: preference.notificationType,
              channel: preference.channel,
            },
          },
          create: {
            userId,
            notificationType: preference.notificationType,
            channel: preference.channel,
            enabled: preference.enabled,
          },
          update: { enabled: preference.enabled },
        }),
      ),
    );
  }
}
