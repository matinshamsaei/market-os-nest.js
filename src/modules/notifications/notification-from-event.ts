import { NotificationChannel, NotificationType } from '@prisma/client';

import { DomainEventJob } from '../events/event-publisher';
import { EventType, EventTypes } from '../events/event-types';

import { CreateNotificationData } from './notifications.repository';

type NotificationSource = {
  orderId: string;
  userId: string;
  amount?: number;
  reason?: string;
};

type NotificationDefinition = {
  type: NotificationType;
  title: string;
  message: (payload: NotificationSource) => string;
};

const notificationsByEvent: Record<EventType, NotificationDefinition> = {
  [EventTypes.ORDER_PAID]: {
    type: NotificationType.ORDER_PAID,
    title: 'Order paid',
    message: ({ orderId }) => `Your order ${orderId} has been paid successfully.`,
  },
  [EventTypes.ORDER_SHIPPED]: {
    type: NotificationType.ORDER_SHIPPED,
    title: 'Order shipped',
    message: ({ orderId }) => `Your order ${orderId} has been shipped.`,
  },
  [EventTypes.ORDER_CANCELLED]: {
    type: NotificationType.ORDER_CANCELLED,
    title: 'Order cancelled',
    message: ({ orderId }) => `Your order ${orderId} has been cancelled.`,
  },
  [EventTypes.PAYMENT_FAILED]: {
    type: NotificationType.PAYMENT_FAILED,
    title: 'Payment failed',
    message: ({ orderId, reason }) =>
      reason
        ? `Payment for order ${orderId} failed: ${reason}`
        : `Payment for order ${orderId} failed.`,
  },
  [EventTypes.REFUND_COMPLETED]: {
    type: NotificationType.REFUND_COMPLETED,
    title: 'Refund completed',
    message: ({ orderId, amount }) => `Your refund of ${amount} for order ${orderId} is complete.`,
  },
};

export function toNotification(event: DomainEventJob): CreateNotificationData | null {
  const definition = notificationsByEvent[event.type];

  if (!definition) {
    return null;
  }

  const payload = event.payload as NotificationSource;

  return {
    eventId: event.id,
    userId: payload.userId,
    type: definition.type,
    channel: NotificationChannel.IN_APP,
    title: definition.title,
    message: definition.message(payload),
  };
}
