import { Module } from '@nestjs/common';

import { PrismaModule } from '@/database/prisma/prisma.module';

import { AuthModule } from '../auth/auth.module';

import { NotificationEventProcessor } from './notification-event.processor';
import { NotificationsController } from './notifications.controller';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsRepository, NotificationEventProcessor],
  exports: [NotificationsService, NotificationsRepository],
})
export class NotificationsModule {}
