import { Injectable } from '@nestjs/common';

import { DomainEventStatus, Prisma } from '@prisma/client';

import { PrismaService } from '@/database/prisma/prisma.service';

import { DOMAIN_EVENT_MAX_ATTEMPTS } from './event-retry.policy';

export interface DomainEventRow {
  id: string;
  type: string;
  payload: Prisma.JsonValue;
  status: DomainEventStatus;
  attemptCount: number;
  maxAttempts: number;
  lastError: string | null;
  nextRetryAt: Date | null;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const RETRYABLE_STATUSES: DomainEventStatus[] = [DomainEventStatus.FAILED, DomainEventStatus.DEAD];

@Injectable()
export class DomainEventsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<DomainEventRow | null> {
    return this.prisma.domainEventRecord.findUnique({ where: { id } });
  }

  async createPending(data: {
    id: string;
    type: string;
    payload: Prisma.InputJsonValue;
    occurredAt: Date;
    maxAttempts?: number;
  }): Promise<DomainEventRow> {
    try {
      return await this.prisma.domainEventRecord.create({
        data: {
          id: data.id,
          type: data.type,
          payload: data.payload,
          occurredAt: data.occurredAt,
          maxAttempts: data.maxAttempts ?? DOMAIN_EVENT_MAX_ATTEMPTS,
          status: DomainEventStatus.PENDING,
        },
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const existing = await this.findById(data.id);

        if (existing) {
          return existing;
        }
      }

      throw error;
    }
  }

  async claimForProcessing(id: string): Promise<DomainEventRow | null> {
    const claimed = await this.prisma.domainEventRecord.updateMany({
      where: {
        id,
        status: { in: [DomainEventStatus.PENDING, DomainEventStatus.FAILED] },
      },
      data: {
        status: DomainEventStatus.PROCESSING,
        attemptCount: { increment: 1 },
        nextRetryAt: null,
      },
    });

    if (claimed.count === 0) {
      return null;
    }

    return this.findById(id);
  }

  markCompleted(id: string): Promise<DomainEventRow> {
    return this.prisma.domainEventRecord.update({
      where: { id },
      data: {
        status: DomainEventStatus.COMPLETED,
        lastError: null,
        nextRetryAt: null,
      },
    });
  }

  markFailed(id: string, lastError: string, nextRetryAt: Date): Promise<DomainEventRow> {
    return this.prisma.domainEventRecord.update({
      where: { id },
      data: {
        status: DomainEventStatus.FAILED,
        lastError,
        nextRetryAt,
      },
    });
  }

  markDead(id: string, lastError: string): Promise<DomainEventRow> {
    return this.prisma.domainEventRecord.update({
      where: { id },
      data: {
        status: DomainEventStatus.DEAD,
        lastError,
        nextRetryAt: null,
      },
    });
  }

  async resetForRetry(id: string): Promise<DomainEventRow | null> {
    const reset = await this.prisma.domainEventRecord.updateMany({
      where: { id, status: { in: RETRYABLE_STATUSES } },
      data: {
        status: DomainEventStatus.PENDING,
        attemptCount: 0,
        lastError: null,
        nextRetryAt: null,
      },
    });

    if (reset.count === 0) {
      return null;
    }

    return this.findById(id);
  }

  findFailed(): Promise<DomainEventRow[]> {
    return this.prisma.domainEventRecord.findMany({
      where: { status: { in: RETRYABLE_STATUSES } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    });
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
