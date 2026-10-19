import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { DomainEventStatus, Prisma, UserRole } from '@prisma/client';
import { Queue } from 'bullmq';

import type { TokenPayload } from '@/shared/types';

import { DOMAIN_EVENTS_DLQ_TOKEN, DOMAIN_EVENTS_QUEUE_TOKEN } from './domain-events.queue';
import { DomainEventRow, DomainEventsRepository } from './domain-events.repository';
import { DomainEvent, DomainEventJob } from './event-publisher';
import { domainEventRetryDelayMs, eventFailureMessage, isDeadEvent } from './event-retry.policy';
import { EventType } from './event-types';

export type FailureOutcome =
  | { status: typeof DomainEventStatus.FAILED; attemptCount: number; delayMs: number }
  | { status: typeof DomainEventStatus.DEAD; attemptCount: number };

@Injectable()
export class EventDeliveryService implements OnModuleDestroy {
  private readonly logger = new Logger(EventDeliveryService.name);

  constructor(
    private readonly domainEventsRepository: DomainEventsRepository,
    @Inject(DOMAIN_EVENTS_QUEUE_TOKEN) private readonly domainEventsQueue: Queue,
    @Inject(DOMAIN_EVENTS_DLQ_TOKEN) private readonly deadLetterQueue: Queue,
  ) {}

  async recordPublished<TType extends EventType, TPayload>(
    event: DomainEvent<TType, TPayload>,
  ): Promise<{ enqueue: boolean }> {
    const record = await this.domainEventsRepository.createPending({
      id: event.id,
      type: event.type,
      payload: event.payload as Prisma.InputJsonValue,
      occurredAt: event.occurredAt,
    });

    return { enqueue: record.status === DomainEventStatus.PENDING };
  }

  async onModuleDestroy(): Promise<void> {
    await this.deadLetterQueue.close();
  }

  beginAttempt(eventId: string): Promise<DomainEventRow | null> {
    return this.domainEventsRepository.claimForProcessing(eventId);
  }

  markCompleted(eventId: string): Promise<DomainEventRow> {
    return this.domainEventsRepository.markCompleted(eventId);
  }

  async recordFailure(event: DomainEventJob, error: unknown): Promise<FailureOutcome> {
    const record = await this.domainEventsRepository.findById(event.id);

    if (!record) {
      throw new NotFoundException('Domain event not found');
    }

    const lastError = eventFailureMessage(error);

    if (isDeadEvent(record.attemptCount, record.maxAttempts)) {
      await this.domainEventsRepository.markDead(record.id, lastError);
      await this.moveToDeadLetter(event);
      return { status: DomainEventStatus.DEAD, attemptCount: record.attemptCount };
    }

    const delayMs = domainEventRetryDelayMs(record.attemptCount);
    const nextRetryAt = new Date(Date.now() + delayMs);

    await this.domainEventsRepository.markFailed(record.id, lastError, nextRetryAt);
    await this.scheduleRetry(event, record.attemptCount, delayMs);

    return { status: DomainEventStatus.FAILED, attemptCount: record.attemptCount, delayMs };
  }

  async listFailed(user: TokenPayload): Promise<DomainEventRow[]> {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can inspect failed events');
    }

    return this.domainEventsRepository.findFailed();
  }

  async retry(eventId: string, user: TokenPayload): Promise<DomainEventRow> {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can retry failed events');
    }

    const existing = await this.domainEventsRepository.findById(eventId);

    if (!existing) {
      throw new NotFoundException('Domain event not found');
    }

    const reset = await this.domainEventsRepository.resetForRetry(eventId);

    if (!reset) {
      throw new BadRequestException('Only failed or dead events can be retried');
    }

    await this.enqueue(this.toJob(reset), `${reset.id}--manual-${Date.now()}`);

    return reset;
  }

  private async scheduleRetry(
    event: DomainEventJob,
    attemptCount: number,
    delayMs: number,
  ): Promise<void> {
    await this.enqueue(event, `${event.id}--attempt-${attemptCount}`, delayMs);
  }

  private async moveToDeadLetter(event: DomainEventJob): Promise<void> {
    try {
      await this.deadLetterQueue.add(event.type, event, { jobId: event.id });
    } catch (error) {
      if (this.isDuplicateJob(error)) {
        return;
      }

      this.logger.error(
        `Failed to enqueue dead letter for ${event.id}: ${eventFailureMessage(error)}`,
      );
    }
  }

  private async enqueue(event: DomainEventJob, jobId: string, delay?: number): Promise<void> {
    try {
      await this.domainEventsQueue.add(event.type, event, {
        jobId,
        attempts: 1,
        ...(delay ? { delay } : {}),
      });
    } catch (error) {
      if (this.isDuplicateJob(error)) {
        return;
      }

      throw error;
    }
  }

  private toJob(record: DomainEventRow): DomainEventJob {
    return {
      id: record.id,
      type: record.type as EventType,
      occurredAt: record.occurredAt.toISOString(),
      payload: record.payload,
    };
  }

  private isDuplicateJob(error: unknown): boolean {
    return error instanceof Error && error.message.toLowerCase().includes('already exists');
  }
}
