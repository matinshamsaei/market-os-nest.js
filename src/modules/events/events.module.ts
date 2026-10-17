import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import { DOMAIN_EVENTS_QUEUE, DOMAIN_EVENTS_QUEUE_TOKEN } from './domain-events.queue';
import { EventBus } from './event-bus';
import { createRedisConnection } from './redis-connection';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: DOMAIN_EVENTS_QUEUE_TOKEN,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        new Queue(DOMAIN_EVENTS_QUEUE, {
          connection: createRedisConnection(configService),
          defaultJobOptions: {
            attempts: 5,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: 1000,
            removeOnFail: 1000,
          },
        }),
    },
    EventBus,
  ],
  exports: [EventBus],
})
export class EventsModule {}
