import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';

import type { TokenPayload } from '@/shared/types';

import { EventsController } from '../events.controller';
import { EventDeliveryService } from '../event-delivery.service';

describe('EventsController', () => {
  let controller: EventsController;

  const admin: TokenPayload = {
    userId: 'admin-1',
    email: 'admin@test.com',
    role: UserRole.ADMIN,
  };

  const eventDeliveryService = {
    listFailed: jest.fn(),
    retry: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EventsController],
      providers: [{ provide: EventDeliveryService, useValue: eventDeliveryService }],
    }).compile();

    controller = module.get(EventsController);
    jest.clearAllMocks();
  });

  it('delegates failed event inspection', async () => {
    const failed = [{ id: 'order-paid-payment-1' }];
    eventDeliveryService.listFailed.mockResolvedValue(failed);

    await expect(controller.listFailed(admin)).resolves.toEqual(failed);
    expect(eventDeliveryService.listFailed).toHaveBeenCalledWith(admin);
  });

  it('delegates a manual retry', async () => {
    const retried = { id: 'order-paid-payment-1', status: 'PENDING' };
    eventDeliveryService.retry.mockResolvedValue(retried);

    await expect(controller.retry(retried.id, admin)).resolves.toEqual(retried);
    expect(eventDeliveryService.retry).toHaveBeenCalledWith(retried.id, admin);
  });
});
