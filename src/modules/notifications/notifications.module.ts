import { Module } from '@nestjs/common';

import { PrismaModule } from '@/database/prisma/prisma.module';

import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';

import { NotificationEventProcessor } from './notification-event.processor';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { NotificationPreferencesRepository } from './notification-preferences.repository';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [AuthModule, EventsModule, PrismaModule],
  controllers: [NotificationsController, NotificationPreferencesController],
  providers: [
    NotificationsService,
    NotificationsRepository,
    NotificationPreferencesService,
    NotificationPreferencesRepository,
    NotificationEventProcessor,
  ],
  exports: [
    NotificationsService,
    NotificationsRepository,
    NotificationPreferencesService,
    NotificationPreferencesRepository,
  ],
})
export class NotificationsModule {}
