import { Inject, Injectable } from '@nestjs/common';

import { Notification, NotificationChannel as NotificationChannelName } from '@prisma/client';

import { PrismaService } from '@/database/prisma/prisma.service';

import type { EmailProvider, NotificationChannel } from './notification-channel';

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

@Injectable()
export class EmailNotificationChannel implements NotificationChannel {
  readonly name = NotificationChannelName.EMAIL;

  constructor(
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
    private readonly prisma: PrismaService,
  ) {}

  async send(notification: Notification): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: notification.userId } });

    if (!user) {
      throw new Error(`Cannot email notification ${notification.id}: user not found`);
    }

    await this.emailProvider.send({
      to: user.email,
      subject: notification.title,
      body: notification.message,
    });
  }
}
