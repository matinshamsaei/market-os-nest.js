import { BadRequestException, Injectable } from '@nestjs/common';

import { PaymentStatus } from '@prisma/client';

@Injectable()
export class PaymentStateMachine {
  private readonly allowedTransitions: Record<PaymentStatus, PaymentStatus[]> = {
    [PaymentStatus.PENDING]: [
      PaymentStatus.PROCESSING,
      PaymentStatus.FAILED,
      PaymentStatus.CANCELLED,
    ],
    [PaymentStatus.PROCESSING]: [
      PaymentStatus.SUCCEEDED,
      PaymentStatus.FAILED,
      PaymentStatus.CANCELLED,
    ],
    [PaymentStatus.SUCCEEDED]: [PaymentStatus.REFUNDED],
    [PaymentStatus.FAILED]: [],
    [PaymentStatus.CANCELLED]: [],
    [PaymentStatus.REFUNDED]: [],
  };

  canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
    if (from === to) {
      return true;
    }

    return this.allowedTransitions[from]?.includes(to) ?? false;
  }

  assertCanTransition(from: PaymentStatus, to: PaymentStatus): void {
    if (from === to) {
      return;
    }

    if (!this.canTransition(from, to)) {
      throw new BadRequestException(`Cannot change payment from ${from} to ${to}`);
    }
  }
}
