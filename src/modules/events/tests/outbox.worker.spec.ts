import { Logger } from '@nestjs/common';
import { OutboxEventStatus } from '@prisma/client';

import { EventTypes } from '../event-types';
import { OutboxRepository } from '../outbox.repository';
import { OutboxWorker } from '../outbox.worker';

describe('OutboxWorker', () => {
  const event = {
    id: 'order-paid-payment-1',
    eventType: EventTypes.ORDER_PAID,
    aggregateType: 'order',
    aggregateId: 'order-1',
    payload: { orderId: 'order-1', userId: 'customer-1', amount: 200 },
    status: OutboxEventStatus.PROCESSING,
    attempts: 1,
    availableAt: new Date('2026-10-19T12:00:30.000Z'),
    processedAt: null,
    lastError: null,
    createdAt: new Date('2026-10-19T12:00:00.000Z'),
  };

  const repository = {
    claimNext: jest.fn(),
    markProcessed: jest.fn(),
    recordFailure: jest.fn(),
  };

  const eventBus = {
    publish: jest.fn(),
  };

  const worker = new OutboxWorker(repository as unknown as OutboxRepository, eventBus as never);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('publishes a claimed event and marks it processed', async () => {
    repository.claimNext.mockResolvedValue(event);
    eventBus.publish.mockResolvedValue(undefined);
    repository.markProcessed.mockResolvedValue({ ...event, status: OutboxEventStatus.PROCESSED });

    await expect(worker.publishNext()).resolves.toEqual(event);

    expect(eventBus.publish).toHaveBeenCalledWith({
      id: event.id,
      type: EventTypes.ORDER_PAID,
      occurredAt: event.createdAt,
      payload: event.payload,
    });
    expect(repository.markProcessed).toHaveBeenCalledWith(event.id);
    expect(repository.recordFailure).not.toHaveBeenCalled();
  });

  it('does nothing when no event is available', async () => {
    repository.claimNext.mockResolvedValue(null);

    await expect(worker.publishNext()).resolves.toBeNull();

    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('records a failure so the event can be retried', async () => {
    repository.claimNext.mockResolvedValue(event);
    eventBus.publish.mockRejectedValue(new Error('redis down'));
    repository.recordFailure.mockResolvedValue({ ...event, status: OutboxEventStatus.FAILED });

    await worker.publishNext();

    expect(repository.recordFailure).toHaveBeenCalledWith(event, expect.any(Error));
    expect(repository.markProcessed).not.toHaveBeenCalled();
  });

  it('skips a second poll while the first is still publishing', async () => {
    let release: () => void = () => undefined;
    repository.claimNext.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(null);
        }),
    );

    const first = worker.poll();
    await Promise.resolve();
    await worker.poll();

    expect(repository.claimNext).toHaveBeenCalledTimes(1);

    release();
    await first;
  });
});
