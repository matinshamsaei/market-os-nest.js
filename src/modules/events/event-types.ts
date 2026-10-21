export const EventTypes = {
  ORDER_PAID: 'order.paid',
  ORDER_CANCELLED: 'order.cancelled',
  PAYMENT_FAILED: 'payment.failed',
  REFUND_COMPLETED: 'refund.completed',
  ORDER_SHIPPED: 'order.shipped',
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];
