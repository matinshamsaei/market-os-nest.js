import { Injectable } from '@nestjs/common';

import { OutboxEvent, OutboxEventStatus } from '@prisma/client';

import { PrismaService } from '@/database/prisma/prisma.service';

import {
  DOMAIN_EVENT_MAX_ATTEMPTS,
  domainEventRetryDelayMs,
  eventFailureMessage,
  isDeadEvent,
} from './event-retry.policy';

const PROCESSING_LEASE_MS = 30_000;

@Injectable()
export class OutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  async claimNext(): Promise<OutboxEvent | null> {
    const rows = await this.prisma.$queryRaw<OutboxEvent[]>`
      WITH next AS (
        SELECT id
        FROM outbox_events
        WHERE (
          status IN ('PENDING', 'FAILED')
          AND "availableAt" <= NOW()
        ) OR (
          status = 'PROCESSING'
          AND "availableAt" <= NOW()
        )
        ORDER BY "createdAt"
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE outbox_events AS claimed
      SET
        status = 'PROCESSING',
        attempts = attempts + 1,
        "availableAt" = NOW() + (${PROCESSING_LEASE_MS} * INTERVAL '1 millisecond')
      FROM next
      WHERE claimed.id = next.id
      RETURNING claimed.*
    `;

    return rows[0] ?? null;
  }

  markProcessed(id: string): Promise<OutboxEvent> {
    return this.prisma.outboxEvent.update({
      where: { id },
      data: {
        status: OutboxEventStatus.PROCESSED,
        processedAt: new Date(),
        lastError: null,
      },
    });
  }

  recordFailure(event: OutboxEvent, error: unknown): Promise<OutboxEvent> {
    const dead = isDeadEvent(event.attempts, DOMAIN_EVENT_MAX_ATTEMPTS);

    return this.prisma.outboxEvent.update({
      where: { id: event.id },
      data: {
        status: dead ? OutboxEventStatus.DEAD : OutboxEventStatus.FAILED,
        lastError: eventFailureMessage(error),
        availableAt: dead
          ? event.availableAt
          : new Date(Date.now() + domainEventRetryDelayMs(event.attempts)),
      },
    });
  }
}
