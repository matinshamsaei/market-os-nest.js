import { NotificationChannel, NotificationStatus, NotificationType } from '@prisma/client';

import { DomainEventJob } from '../events/event-publisher';
import {
  OrderCancelledPayload,
  OrderPaidPayload,
  OrderShippedPayload,
  PaymentFailedPayload,
  RefundCompletedPayload,
} from '../events/event-payloads';
import { EventTypes } from '../events/event-types';

import { CreateNotificationData } from './notifications.repository';

export function toNotification(event: DomainEventJob): CreateNotificationData | null {
  switch (event.type) {
    case EventTypes.ORDER_PAID:
      return fromOrderPaid(event.id, event.payload as OrderPaidPayload);
    case EventTypes.ORDER_SHIPPED:
      return fromOrderShipped(event.id, event.payload as OrderShippedPayload);
    case EventTypes.ORDER_CANCELLED:
      return fromOrderCancelled(event.id, event.payload as OrderCancelledPayload);
    case EventTypes.PAYMENT_FAILED:
      return fromPaymentFailed(event.id, event.payload as PaymentFailedPayload);
    case EventTypes.REFUND_COMPLETED:
      return fromRefundCompleted(event.id, event.payload as RefundCompletedPayload);
    default:
      return null;
  }
}

function fromOrderPaid(eventId: string, payload: OrderPaidPayload): CreateNotificationData {
  return {
    eventId,
    userId: payload.userId,
    type: NotificationType.ORDER_PAID,
    channel: NotificationChannel.IN_APP,
    title: 'Order paid',
    message: `Your order ${payload.orderId} has been paid successfully.`,
    status: NotificationStatus.SENT,
  };
}

function fromOrderShipped(eventId: string, payload: OrderShippedPayload): CreateNotificationData {
  return {
    eventId,
    userId: payload.userId,
    type: NotificationType.ORDER_SHIPPED,
    channel: NotificationChannel.IN_APP,
    title: 'Order shipped',
    message: `Your order ${payload.orderId} has been shipped.`,
    status: NotificationStatus.SENT,
  };
}

function fromOrderCancelled(
  eventId: string,
  payload: OrderCancelledPayload,
): CreateNotificationData {
  return {
    eventId,
    userId: payload.userId,
    type: NotificationType.ORDER_CANCELLED,
    channel: NotificationChannel.IN_APP,
    title: 'Order cancelled',
    message: `Your order ${payload.orderId} has been cancelled.`,
    status: NotificationStatus.SENT,
  };
}

function fromPaymentFailed(eventId: string, payload: PaymentFailedPayload): CreateNotificationData {
  const reason = payload.reason ? `: ${payload.reason}` : '.';

  return {
    eventId,
    userId: payload.userId,
    type: NotificationType.PAYMENT_FAILED,
    channel: NotificationChannel.IN_APP,
    title: 'Payment failed',
    message: `Payment for order ${payload.orderId} failed${reason}`,
    status: NotificationStatus.SENT,
  };
}

function fromRefundCompleted(
  eventId: string,
  payload: RefundCompletedPayload,
): CreateNotificationData {
  return {
    eventId,
    userId: payload.userId,
    type: NotificationType.REFUND_COMPLETED,
    channel: NotificationChannel.IN_APP,
    title: 'Refund completed',
    message: `Your refund of ${payload.amount} for order ${payload.orderId} is complete.`,
    status: NotificationStatus.SENT,
  };
}
