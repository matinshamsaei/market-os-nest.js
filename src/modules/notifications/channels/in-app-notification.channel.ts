import { Injectable } from '@nestjs/common';

import { Notification, NotificationChannel as NotificationChannelName } from '@prisma/client';

import { NotificationChannel } from './notification-channel';

@Injectable()
export class InAppNotificationChannel implements NotificationChannel {
  readonly name = NotificationChannelName.IN_APP;

  send(_notification: Notification): Promise<void> {
    return Promise.resolve();
  }
}
