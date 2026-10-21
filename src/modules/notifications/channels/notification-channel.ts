import { Notification, NotificationChannel as NotificationChannelName } from '@prisma/client';

export interface NotificationChannel {
  readonly name: NotificationChannelName;
  send(notification: Notification): Promise<void>;
}

export type OutboundEmail = {
  to: string;
  subject: string;
  body: string;
};

export interface EmailProvider {
  send(email: OutboundEmail): Promise<void>;
}
