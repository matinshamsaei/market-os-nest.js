import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { OutboxEvent } from '@prisma/client';

import { EventBus } from './event-bus';
import { EventType } from './event-types';
import { OutboxRepository } from './outbox.repository';

const OUTBOX_POLL_INTERVAL_MS = 1000;

@Injectable()
export class OutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly outboxRepository: OutboxRepository,
    private readonly eventBus: EventBus,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.poll();
    }, OUTBOX_POLL_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async poll(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      await this.publishNext();
    } finally {
      this.running = false;
    }
  }

  async publishNext(): Promise<OutboxEvent | null> {
    const event = await this.outboxRepository.claimNext();

    if (!event) {
      return null;
    }

    try {
      await this.eventBus.publish({
        id: event.id,
        type: event.eventType as EventType,
        occurredAt: event.createdAt,
        payload: event.payload,
      });
      await this.outboxRepository.markProcessed(event.id);

      return event;
    } catch (error) {
      this.logger.error(
        `Outbox event ${event.id} failed`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.outboxRepository.recordFailure(event, error);

      return event;
    }
  }
}
