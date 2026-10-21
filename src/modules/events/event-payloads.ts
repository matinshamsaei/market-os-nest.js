export interface OrderPaidPayload {
  orderId: string;
  userId: string;
  amount: number;
  paymentId?: string;
}

export interface OrderCancelledPayload {
  orderId: string;
  userId: string;
}

export interface PaymentFailedPayload {
  orderId: string;
  userId: string;
  paymentId: string;
  reason?: string;
  provider?: string;
  code?: string;
}

export interface RefundCompletedPayload {
  orderId: string;
  userId: string;
  amount: number;
  refundId?: string;
}

export interface OrderShippedPayload {
  orderId: string;
  userId: string;
}
