import { Test, TestingModule } from '@nestjs/testing';
import { NotificationChannel, NotificationType, UserRole } from '@prisma/client';

import type { TokenPayload } from '@/shared/types';

import { NotificationPreferencesRepository } from '../notification-preferences.repository';
import { NotificationPreferencesService } from '../notification-preferences.service';

describe('NotificationPreferencesService', () => {
  let service: NotificationPreferencesService;

  const customer: TokenPayload = {
    userId: 'customer-1',
    email: 'customer@test.com',
    role: UserRole.CUSTOMER,
  };

  const repository = {
    findForUser: jest.fn(),
    findOne: jest.fn(),
    upsertMany: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationPreferencesService,
        { provide: NotificationPreferencesRepository, useValue: repository },
      ],
    }).compile();

    service = module.get(NotificationPreferencesService);
    jest.clearAllMocks();
  });

  it('enables every channel by default', async () => {
    repository.findForUser.mockResolvedValue([]);

    const result = await service.getPreferences(customer);

    expect(result.preferences).toEqual(
      expect.arrayContaining([
        {
          notificationType: NotificationType.ORDER_PAID,
          channel: NotificationChannel.EMAIL,
          enabled: true,
        },
        {
          notificationType: NotificationType.ORDER_PAID,
          channel: NotificationChannel.IN_APP,
          enabled: true,
        },
      ]),
    );
    expect(result.preferences).toHaveLength(
      Object.values(NotificationType).length * Object.values(NotificationChannel).length,
    );
  });

  it('keeps a stored disabled preference', async () => {
    repository.findForUser.mockResolvedValue([
      {
        notificationType: NotificationType.PAYMENT_FAILED,
        channel: NotificationChannel.EMAIL,
        enabled: false,
      },
    ]);

    const result = await service.getPreferences(customer);
    const email = result.preferences.find(
      (preference) =>
        preference.notificationType === NotificationType.PAYMENT_FAILED &&
        preference.channel === NotificationChannel.EMAIL,
    );
    const inApp = result.preferences.find(
      (preference) =>
        preference.notificationType === NotificationType.PAYMENT_FAILED &&
        preference.channel === NotificationChannel.IN_APP,
    );

    expect(email?.enabled).toBe(false);
    expect(inApp?.enabled).toBe(true);
  });

  it('upserts only the current user preferences', async () => {
    const updates = [
      {
        notificationType: NotificationType.PAYMENT_FAILED,
        channel: NotificationChannel.EMAIL,
        enabled: false,
      },
    ];
    repository.upsertMany.mockResolvedValue([]);
    repository.findForUser.mockResolvedValue([
      {
        userId: customer.userId,
        notificationType: NotificationType.PAYMENT_FAILED,
        channel: NotificationChannel.EMAIL,
        enabled: false,
      },
    ]);

    await service.updatePreferences(customer, updates);

    expect(repository.upsertMany).toHaveBeenCalledWith(customer.userId, updates);
  });

  it('treats a missing preference as enabled', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(
      service.isEnabled(customer.userId, NotificationType.ORDER_PAID, NotificationChannel.IN_APP),
    ).resolves.toBe(true);
  });
});
