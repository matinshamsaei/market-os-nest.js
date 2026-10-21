import { Module } from '@nestjs/common';

import { PrismaModule } from '@/database/prisma/prisma.module';

import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';

import { EmailNotificationChannel } from './channels/email-notification.channel';
import { EMAIL_PROVIDER } from './channels/email-notification.channel';
import { FakeEmailProvider } from './channels/fake-email.provider';
import { InAppNotificationChannel } from './channels/in-app-notification.channel';
import { NotificationDispatcher } from './channels/notification-dispatcher';
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
    NotificationDispatcher,
    InAppNotificationChannel,
    EmailNotificationChannel,
    FakeEmailProvider,
    { provide: EMAIL_PROVIDER, useExisting: FakeEmailProvider },
    NotificationEventProcessor,
  ],
  exports: [
    NotificationsService,
    NotificationsRepository,
    NotificationPreferencesService,
    NotificationPreferencesRepository,
    NotificationDispatcher,
    FakeEmailProvider,
  ],
})
export class NotificationsModule {}
