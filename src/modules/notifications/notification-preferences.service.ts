import { Injectable } from '@nestjs/common';

import { NotificationChannel, NotificationType } from '@prisma/client';

import type { TokenPayload } from '@/shared/types';

import { UpdateNotificationPreferenceDto } from './dto';
import { NotificationPreferencesRepository } from './notification-preferences.repository';

const NOTIFICATION_TYPES = Object.values(NotificationType);
const NOTIFICATION_CHANNELS = Object.values(NotificationChannel);

export type NotificationPreferenceView = {
  notificationType: NotificationType;
  channel: NotificationChannel;
  enabled: boolean;
};

@Injectable()
export class NotificationPreferencesService {
  constructor(private readonly preferencesRepository: NotificationPreferencesRepository) {}

  async getPreferences(user: TokenPayload): Promise<{ preferences: NotificationPreferenceView[] }> {
    const stored = await this.preferencesRepository.findForUser(user.userId);
    const enabledByKey = new Map(
      stored.map((preference) => [
        this.key(preference.notificationType, preference.channel),
        preference.enabled,
      ]),
    );

    const preferences = NOTIFICATION_TYPES.flatMap((notificationType) =>
      NOTIFICATION_CHANNELS.map((channel) => ({
        notificationType,
        channel,
        enabled: enabledByKey.get(this.key(notificationType, channel)) ?? true,
      })),
    );

    return { preferences };
  }

  async updatePreferences(
    user: TokenPayload,
    preferences: UpdateNotificationPreferenceDto[],
  ): Promise<{ preferences: NotificationPreferenceView[] }> {
    if (preferences.length > 0) {
      await this.preferencesRepository.upsertMany(user.userId, preferences);
    }

    return this.getPreferences(user);
  }

  async isEnabled(
    userId: string,
    notificationType: NotificationType,
    channel: NotificationChannel,
  ): Promise<boolean> {
    const preference = await this.preferencesRepository.findOne(userId, notificationType, channel);

    return preference?.enabled ?? true;
  }

  private key(notificationType: NotificationType, channel: NotificationChannel): string {
    return `${notificationType}:${channel}`;
  }
}
