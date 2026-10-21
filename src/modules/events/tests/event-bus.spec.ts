import { Test, TestingModule } from '@nestjs/testing';

import { DOMAIN_EVENTS_QUEUE_TOKEN } from '../domain-events.queue';
import { EventBus } from '../event-bus';
import { EventDeliveryService } from '../event-delivery.service';
import { EventTypes } from '../event-types';

describe('EventBus', () => {
  let eventBus: EventBus;

  const queue = {
    add: jest.fn(),
    close: jest.fn(),
  };

  const eventDeliveryService = {
    recordPublished: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventBus,
        {
          provide: DOMAIN_EVENTS_QUEUE_TOKEN,
          useValue: queue,
        },
        {
          provide: EventDeliveryService,
          useValue: eventDeliveryService,
        },
      ],
    }).compile();

    eventBus = module.get(EventBus);
    jest.clearAllMocks();
  });

  it('enqueues the event and returns without waiting for a consumer', async () => {
    const occurredAt = new Date('2026-01-01T00:00:00.000Z');
    eventDeliveryService.recordPublished.mockResolvedValue({ enqueue: true });
    queue.add.mockResolvedValue({ id: 'order-paid-payment-1' });

    await eventBus.publish({
      id: 'order-paid-payment-1',
      type: EventTypes.ORDER_PAID,
      occurredAt,
      payload: { orderId: 'order-1', userId: 'customer-1', amount: 200 },
    });

    expect(queue.add).toHaveBeenCalledWith(
      EventTypes.ORDER_PAID,
      {
        id: 'order-paid-payment-1',
        type: EventTypes.ORDER_PAID,
        occurredAt: occurredAt.toISOString(),
        payload: { orderId: 'order-1', userId: 'customer-1', amount: 200 },
      },
      { jobId: 'order-paid-payment-1', attempts: 1 },
    );
  });

  it('does not enqueue an event that is already being handled', async () => {
    eventDeliveryService.recordPublished.mockResolvedValue({ enqueue: false });

    await eventBus.publish({
      id: 'order-paid-payment-1',
      type: EventTypes.ORDER_PAID,
      occurredAt: new Date(),
      payload: { orderId: 'order-1', userId: 'customer-1', amount: 200 },
    });

    expect(queue.add).not.toHaveBeenCalled();
  });

  it('treats a duplicate job id as a successful publish', async () => {
    eventDeliveryService.recordPublished.mockResolvedValue({ enqueue: true });
    queue.add.mockRejectedValue(new Error('Job order-paid-payment-1 already exists'));

    await expect(
      eventBus.publish({
        id: 'order-paid-payment-1',
        type: EventTypes.ORDER_PAID,
        occurredAt: new Date(),
        payload: { orderId: 'order-1', userId: 'customer-1', amount: 200 },
      }),
    ).resolves.toBeUndefined();
  });
});
