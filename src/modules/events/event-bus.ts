import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';

import { DOMAIN_EVENTS_QUEUE_TOKEN } from './domain-events.queue';
import { DomainEvent, DomainEventJob, EventPublisher } from './event-publisher';
import { EventType } from './event-types';

@Injectable()
export class EventBus implements EventPublisher, OnModuleDestroy {
  constructor(@Inject(DOMAIN_EVENTS_QUEUE_TOKEN) private readonly domainEventsQueue: Queue) {}

  async publish<TType extends EventType, TPayload>(
    event: DomainEvent<TType, TPayload>,
  ): Promise<void> {
    const job: DomainEventJob<TPayload> = {
      id: event.id,
      type: event.type,
      occurredAt: event.occurredAt.toISOString(),
      payload: event.payload,
    };

    try {
      await this.domainEventsQueue.add(event.type, job, {
        jobId: event.id,
      });
    } catch (error) {
      if (this.isDuplicateJob(error)) {
        return;
      }

      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.domainEventsQueue.close();
  }

  private isDuplicateJob(error: unknown): boolean {
    return error instanceof Error && error.message.toLowerCase().includes('already exists');
  }
}
