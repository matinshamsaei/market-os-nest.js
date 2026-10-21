import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';

import { EventDeliveryService } from '../../events/event-delivery.service';
import { DomainEventJob } from '../../events/event-publisher';
import { EventTypes } from '../../events/event-types';
import { NotificationEventProcessor } from '../notification-event.processor';
import { NotificationsService } from '../notifications.service';

describe('NotificationEventProcessor', () => {
  const notificationsService = {
    createFromDomainEvent: jest.fn(),
  };

  const eventDeliveryService = {
    beginAttempt: jest.fn(),
    markCompleted: jest.fn(),
    recordFailure: jest.fn(),
  };

  const processor = new NotificationEventProcessor(
    { get: jest.fn() } as unknown as ConfigService,
    notificationsService as unknown as NotificationsService,
    eventDeliveryService as unknown as EventDeliveryService,
  );

  const event = {
    id: 'order-paid-payment-1',
    type: EventTypes.ORDER_PAID,
    occurredAt: '2026-01-01T00:00:00.000Z',
    payload: { orderId: 'order-1', userId: 'customer-1', amount: 200 },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a notification and marks the event completed', async () => {
    eventDeliveryService.beginAttempt.mockResolvedValue({ id: event.id });
    notificationsService.createFromDomainEvent.mockResolvedValue({ id: 'notification-1' });

    await processor.process({ data: event } as Job<DomainEventJob>);

    expect(notificationsService.createFromDomainEvent).toHaveBeenCalledWith(event);
    expect(eventDeliveryService.markCompleted).toHaveBeenCalledWith(event.id);
    expect(eventDeliveryService.recordFailure).not.toHaveBeenCalled();
  });

  it('records a failure when notification creation throws', async () => {
    const error = new Error('Database temporarily unavailable');
    eventDeliveryService.beginAttempt.mockResolvedValue({ id: event.id });
    notificationsService.createFromDomainEvent.mockRejectedValue(error);

    await processor.process({ data: event } as Job<DomainEventJob>);

    expect(eventDeliveryService.recordFailure).toHaveBeenCalledWith(event, error);
    expect(eventDeliveryService.markCompleted).not.toHaveBeenCalled();
  });

  it('skips a redelivery that is already completed or dead', async () => {
    eventDeliveryService.beginAttempt.mockResolvedValue(null);

    await processor.process({ data: event } as Job<DomainEventJob>);

    expect(notificationsService.createFromDomainEvent).not.toHaveBeenCalled();
    expect(eventDeliveryService.markCompleted).not.toHaveBeenCalled();
  });
});
