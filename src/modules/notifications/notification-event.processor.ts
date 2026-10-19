import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';

import { DOMAIN_EVENTS_QUEUE } from '../events/domain-events.queue';
import { EventDeliveryService } from '../events/event-delivery.service';
import { DomainEventJob } from '../events/event-publisher';
import { createRedisConnection } from '../events/redis-connection';

import { NotificationsService } from './notifications.service';

@Injectable()
export class NotificationEventProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationEventProcessor.name);
  private worker?: Worker;

  constructor(
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
    private readonly eventDeliveryService: EventDeliveryService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker(DOMAIN_EVENTS_QUEUE, (job: Job<DomainEventJob>) => this.process(job), {
      connection: createRedisConnection(this.configService),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  async process(job: Job<DomainEventJob>): Promise<void> {
    const claimed = await this.eventDeliveryService.beginAttempt(job.data.id);

    if (!claimed) {
      return;
    }

    try {
      const notification = await this.notificationsService.createFromDomainEvent(job.data);

      if (!notification) {
        this.logger.warn(`No notification mapping for event ${job.data.type}`);
      }

      await this.eventDeliveryService.markCompleted(job.data.id);
    } catch (error) {
      await this.eventDeliveryService.recordFailure(job.data, error);
    }
  }
}
