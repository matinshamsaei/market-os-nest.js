import { OutboxEventStatus } from '@prisma/client';

import { PrismaService } from '@/database/prisma/prisma.service';

import { OutboxRepository } from '../outbox.repository';

describe('OutboxRepository', () => {
  const prisma = {
    $queryRaw: jest.fn(),
    outboxEvent: {
      update: jest.fn(),
    },
  };

  const repository = new OutboxRepository(prisma as unknown as PrismaService);

  const event = {
    id: 'order-paid-payment-1',
    eventType: 'order.paid',
    aggregateType: 'order',
    aggregateId: 'order-1',
    payload: { orderId: 'order-1' },
    status: OutboxEventStatus.PROCESSING,
    attempts: 5,
    availableAt: new Date('2026-10-19T12:00:00.000Z'),
    processedAt: null,
    lastError: null,
    createdAt: new Date('2026-10-19T12:00:00.000Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when the lock query finds no row', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    await expect(repository.claimNext()).resolves.toBeNull();
  });

  it('returns the locked row', async () => {
    prisma.$queryRaw.mockResolvedValue([event]);

    await expect(repository.claimNext()).resolves.toEqual(event);
  });

  it('moves a permanently failed event to DEAD', async () => {
    prisma.outboxEvent.update.mockResolvedValue({ ...event, status: OutboxEventStatus.DEAD });

    await repository.recordFailure(event, new Error('still down'));

    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: event.id },
      data: expect.objectContaining({
        status: OutboxEventStatus.DEAD,
        lastError: 'still down',
      }),
    });
  });

  it('schedules a retry when attempts remain', async () => {
    prisma.outboxEvent.update.mockResolvedValue({
      ...event,
      attempts: 1,
      status: OutboxEventStatus.FAILED,
    });

    await repository.recordFailure({ ...event, attempts: 1 }, new Error('timeout'));

    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: event.id },
      data: expect.objectContaining({
        status: OutboxEventStatus.FAILED,
        lastError: 'timeout',
        availableAt: expect.any(Date),
      }),
    });
  });
});
