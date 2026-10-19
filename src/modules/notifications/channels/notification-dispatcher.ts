import { Injectable } from '@nestjs/common';

import { Notification, NotificationChannel as NotificationChannelName } from '@prisma/client';

import { EmailNotificationChannel } from './email-notification.channel';
import { InAppNotificationChannel } from './in-app-notification.channel';
import { NotificationChannel } from './notification-channel';

@Injectable()
export class NotificationDispatcher {
  private readonly channels: Map<NotificationChannelName, NotificationChannel>;

  constructor(inApp: InAppNotificationChannel, email: EmailNotificationChannel) {
    this.channels = new Map<NotificationChannelName, NotificationChannel>([
      [inApp.name, inApp],
      [email.name, email],
    ]);
  }

  send(notification: Notification): Promise<void> {
    const channel = this.channels.get(notification.channel);

    if (!channel) {
      throw new Error(`Unsupported notification channel ${notification.channel}`);
    }

    return channel.send(notification);
  }
}
