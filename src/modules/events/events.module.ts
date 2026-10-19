import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import { PrismaModule } from '@/database/prisma/prisma.module';

import { AuthModule } from '../auth/auth.module';

import {
  DOMAIN_EVENTS_DLQ,
  DOMAIN_EVENTS_DLQ_TOKEN,
  DOMAIN_EVENTS_QUEUE,
  DOMAIN_EVENTS_QUEUE_TOKEN,
} from './domain-events.queue';
import { DomainEventsRepository } from './domain-events.repository';
import { EventBus } from './event-bus';
import { EventDeliveryService } from './event-delivery.service';
import { EventsController } from './events.controller';
import { createRedisConnection } from './redis-connection';

@Module({
  imports: [AuthModule, ConfigModule, PrismaModule],
  controllers: [EventsController],
  providers: [
    {
      provide: DOMAIN_EVENTS_QUEUE_TOKEN,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        new Queue(DOMAIN_EVENTS_QUEUE, {
          connection: createRedisConnection(configService),
          defaultJobOptions: {
            attempts: 1,
            removeOnComplete: 1000,
            removeOnFail: 1000,
          },
        }),
    },
    {
      provide: DOMAIN_EVENTS_DLQ_TOKEN,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        new Queue(DOMAIN_EVENTS_DLQ, {
          connection: createRedisConnection(configService),
          defaultJobOptions: {
            attempts: 1,
            removeOnComplete: false,
            removeOnFail: false,
          },
        }),
    },
    DomainEventsRepository,
    EventDeliveryService,
    EventBus,
  ],
  exports: [EventBus, EventDeliveryService],
})
export class EventsModule {}
