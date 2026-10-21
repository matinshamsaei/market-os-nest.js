import { Test } from '@nestjs/testing';
import { NotificationChannel, NotificationStatus, NotificationType } from '@prisma/client';

import { PrismaService } from '@/database/prisma/prisma.service';

import { EMAIL_PROVIDER, EmailNotificationChannel } from '../channels/email-notification.channel';
import { FakeEmailProvider } from '../channels/fake-email.provider';
import { InAppNotificationChannel } from '../channels/in-app-notification.channel';
import { NotificationDispatcher } from '../channels/notification-dispatcher';

describe('NotificationDispatcher', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
  };

  const notification = {
    id: 'notification-1',
    userId: 'customer-1',
    type: NotificationType.ORDER_PAID,
    channel: NotificationChannel.EMAIL,
    title: 'Order paid',
    message: 'Your order order-1 has been paid successfully.',
    status: NotificationStatus.PENDING,
    readAt: null,
    eventId: 'order-paid-payment-1',
    createdAt: new Date(),
  };

  let dispatcher: NotificationDispatcher;
  let emails: FakeEmailProvider;

  beforeEach(async () => {
    emails = new FakeEmailProvider();
    const module = await Test.createTestingModule({
      providers: [
        NotificationDispatcher,
        InAppNotificationChannel,
        EmailNotificationChannel,
        { provide: EMAIL_PROVIDER, useValue: emails },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    dispatcher = module.get(NotificationDispatcher);
    jest.clearAllMocks();
  });

  it('delivers an in-app notification without sending email', async () => {
    await expect(
      dispatcher.send({ ...notification, channel: NotificationChannel.IN_APP }),
    ).resolves.toBeUndefined();

    expect(emails.sent).toEqual([]);
  });

  it('sends email through the fake provider', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'customer-1',
      email: 'customer@test.com',
    });

    await dispatcher.send(notification);

    expect(emails.sent).toEqual([
      {
        to: 'customer@test.com',
        subject: notification.title,
        body: notification.message,
      },
    ]);
  });
});
