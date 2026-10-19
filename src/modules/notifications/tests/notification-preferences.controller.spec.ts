import { Test, TestingModule } from '@nestjs/testing';
import { NotificationChannel, NotificationType, UserRole } from '@prisma/client';

import type { TokenPayload } from '@/shared/types';

import { NotificationPreferencesController } from '../notification-preferences.controller';
import { NotificationPreferencesService } from '../notification-preferences.service';

describe('NotificationPreferencesController', () => {
  let controller: NotificationPreferencesController;

  const preferencesService = {
    getPreferences: jest.fn(),
    updatePreferences: jest.fn(),
  };

  const customer: TokenPayload = {
    userId: 'customer-1',
    email: 'customer@test.com',
    role: UserRole.CUSTOMER,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationPreferencesController],
      providers: [{ provide: NotificationPreferencesService, useValue: preferencesService }],
    }).compile();

    controller = module.get(NotificationPreferencesController);
    jest.clearAllMocks();
  });

  it('lists the current user preferences', async () => {
    const response = { preferences: [] };
    preferencesService.getPreferences.mockResolvedValue(response);

    await expect(controller.getPreferences(customer)).resolves.toEqual(response);
    expect(preferencesService.getPreferences).toHaveBeenCalledWith(customer);
  });

  it('updates the current user preferences', async () => {
    const preferences = [
      {
        notificationType: NotificationType.PAYMENT_FAILED,
        channel: NotificationChannel.EMAIL,
        enabled: false,
      },
    ];
    const response = { preferences };
    preferencesService.updatePreferences.mockResolvedValue(response);

    await expect(controller.updatePreferences(customer, { preferences })).resolves.toEqual(
      response,
    );
    expect(preferencesService.updatePreferences).toHaveBeenCalledWith(customer, preferences);
  });
});
