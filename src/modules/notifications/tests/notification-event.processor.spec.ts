import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';

import { DomainEventJob } from '../../events/event-publisher';
import { EventTypes } from '../../events/event-types';
import { NotificationEventProcessor } from '../notification-event.processor';
import { NotificationsService } from '../notifications.service';

describe('NotificationEventProcessor', () => {
  const notificationsService = {
    createFromDomainEvent: jest.fn(),
  };

  const processor = new NotificationEventProcessor(
    { get: jest.fn() } as unknown as ConfigService,
    notificationsService as unknown as NotificationsService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a notification from the queued event', async () => {
    const event = {
      id: 'order-paid-payment-1',
      type: EventTypes.ORDER_PAID,
      occurredAt: '2026-01-01T00:00:00.000Z',
      payload: { orderId: 'order-1', userId: 'customer-1', amount: 200 },
    };
    notificationsService.createFromDomainEvent.mockResolvedValue({ id: 'notification-1' });

    await processor.process({ data: event } as Job<DomainEventJob>);

    expect(notificationsService.createFromDomainEvent).toHaveBeenCalledWith(event);
  });
});
