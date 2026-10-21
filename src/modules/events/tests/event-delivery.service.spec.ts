import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DomainEventStatus, UserRole } from '@prisma/client';

import type { TokenPayload } from '@/shared/types';

import { DOMAIN_EVENTS_DLQ_TOKEN, DOMAIN_EVENTS_QUEUE_TOKEN } from '../domain-events.queue';
import { DomainEventsRepository } from '../domain-events.repository';
import { EventDeliveryService } from '../event-delivery.service';
import { EventTypes } from '../event-types';

describe('EventDeliveryService', () => {
  let service: EventDeliveryService;

  const admin: TokenPayload = {
    userId: 'admin-1',
    email: 'admin@test.com',
    role: UserRole.ADMIN,
  };

  const customer: TokenPayload = {
    userId: 'customer-1',
    email: 'customer@test.com',
    role: UserRole.CUSTOMER,
  };

  const storedEvent = {
    id: 'order-paid-payment-1',
    type: EventTypes.ORDER_PAID,
    payload: { orderId: 'order-1', userId: 'customer-1', amount: 200 },
    status: DomainEventStatus.PENDING,
    attemptCount: 0,
    maxAttempts: 5,
    lastError: null,
    nextRetryAt: null,
    occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const repository = {
    createPending: jest.fn(),
    findById: jest.fn(),
    claimForProcessing: jest.fn(),
    markCompleted: jest.fn(),
    markFailed: jest.fn(),
    markDead: jest.fn(),
    resetForRetry: jest.fn(),
    findFailed: jest.fn(),
  };

  const queue = {
    add: jest.fn(),
    close: jest.fn(),
  };

  const deadLetterQueue = {
    add: jest.fn(),
    close: jest.fn(),
  };

  const job = {
    id: storedEvent.id,
    type: EventTypes.ORDER_PAID,
    occurredAt: storedEvent.occurredAt.toISOString(),
    payload: storedEvent.payload,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventDeliveryService,
        { provide: DomainEventsRepository, useValue: repository },
        { provide: DOMAIN_EVENTS_QUEUE_TOKEN, useValue: queue },
        { provide: DOMAIN_EVENTS_DLQ_TOKEN, useValue: deadLetterQueue },
      ],
    }).compile();

    service = module.get(EventDeliveryService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stores a new event as pending and allows the first enqueue', async () => {
    repository.createPending.mockResolvedValue(storedEvent);

    await expect(
      service.recordPublished({
        id: storedEvent.id,
        type: EventTypes.ORDER_PAID,
        occurredAt: storedEvent.occurredAt,
        payload: storedEvent.payload,
      }),
    ).resolves.toEqual({ enqueue: true });
  });

  it('does not enqueue an event that is already completed', async () => {
    repository.createPending.mockResolvedValue({
      ...storedEvent,
      status: DomainEventStatus.COMPLETED,
    });

    await expect(
      service.recordPublished({
        id: storedEvent.id,
        type: EventTypes.ORDER_PAID,
        occurredAt: storedEvent.occurredAt,
        payload: storedEvent.payload,
      }),
    ).resolves.toEqual({ enqueue: false });
  });

  it('schedules a delayed retry and records the error after a failed attempt', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    repository.findById.mockResolvedValue({ ...storedEvent, attemptCount: 1 });
    repository.markFailed.mockResolvedValue({ ...storedEvent, status: DomainEventStatus.FAILED });

    await expect(
      service.recordFailure(job, new Error('Database temporarily unavailable')),
    ).resolves.toEqual({
      status: DomainEventStatus.FAILED,
      attemptCount: 1,
      delayMs: 1000,
    });

    expect(repository.markFailed).toHaveBeenCalledWith(
      storedEvent.id,
      'Database temporarily unavailable',
      new Date('2026-01-01T00:00:01.000Z'),
    );
    expect(queue.add).toHaveBeenCalledWith(EventTypes.ORDER_PAID, job, {
      jobId: 'order-paid-payment-1--attempt-1',
      attempts: 1,
      delay: 1000,
    });
    expect(deadLetterQueue.add).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('moves an exhausted event to the dead letter queue', async () => {
    repository.findById.mockResolvedValue({ ...storedEvent, attemptCount: 5, maxAttempts: 5 });
    repository.markDead.mockResolvedValue({ ...storedEvent, status: DomainEventStatus.DEAD });

    await expect(
      service.recordFailure(job, new Error('Database temporarily unavailable')),
    ).resolves.toEqual({
      status: DomainEventStatus.DEAD,
      attemptCount: 5,
    });

    expect(repository.markDead).toHaveBeenCalledWith(
      storedEvent.id,
      'Database temporarily unavailable',
    );
    expect(deadLetterQueue.add).toHaveBeenCalledWith(EventTypes.ORDER_PAID, job, {
      jobId: storedEvent.id,
    });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('lists failed and dead events for admins', async () => {
    const failed = [{ ...storedEvent, status: DomainEventStatus.FAILED }];
    repository.findFailed.mockResolvedValue(failed);

    await expect(service.listFailed(admin)).resolves.toEqual(failed);
    await expect(service.listFailed(customer)).rejects.toThrow(ForbiddenException);
  });

  it('retries a dead event by returning it to pending', async () => {
    const now = new Date('2026-01-01T00:00:05.000Z');
    jest.useFakeTimers().setSystemTime(now);
    repository.findById.mockResolvedValue({ ...storedEvent, status: DomainEventStatus.DEAD });
    repository.resetForRetry.mockResolvedValue(storedEvent);

    await expect(service.retry(storedEvent.id, admin)).resolves.toEqual(storedEvent);
    expect(queue.add).toHaveBeenCalledWith(
      EventTypes.ORDER_PAID,
      expect.objectContaining({ id: storedEvent.id, type: EventTypes.ORDER_PAID }),
      { jobId: `order-paid-payment-1--manual-${now.getTime()}`, attempts: 1 },
    );

    jest.useRealTimers();
  });

  it('rejects a retry when the event is not failed', async () => {
    repository.findById.mockResolvedValue(storedEvent);
    repository.resetForRetry.mockResolvedValue(null);

    await expect(service.retry(storedEvent.id, admin)).rejects.toThrow(BadRequestException);
  });

  it('returns not found when retrying a missing event', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(service.retry('missing', admin)).rejects.toThrow(NotFoundException);
  });
});
