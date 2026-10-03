import { BadRequestException } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';

import { PaymentStateMachine } from '../payment-state-machine';

describe('PaymentStateMachine', () => {
  const stateMachine = new PaymentStateMachine();

  it('allows PENDING → PROCESSING → SUCCEEDED', () => {
    expect(stateMachine.canTransition(PaymentStatus.PENDING, PaymentStatus.PROCESSING)).toBe(true);
    expect(stateMachine.canTransition(PaymentStatus.PROCESSING, PaymentStatus.SUCCEEDED)).toBe(
      true,
    );
  });

  it('allows PROCESSING → FAILED', () => {
    expect(stateMachine.canTransition(PaymentStatus.PROCESSING, PaymentStatus.FAILED)).toBe(true);
  });

  it('allows SUCCEEDED → REFUNDED', () => {
    expect(stateMachine.canTransition(PaymentStatus.SUCCEEDED, PaymentStatus.REFUNDED)).toBe(true);
  });

  it('rejects illegal transitions', () => {
    expect(stateMachine.canTransition(PaymentStatus.PENDING, PaymentStatus.SUCCEEDED)).toBe(false);
    expect(stateMachine.canTransition(PaymentStatus.FAILED, PaymentStatus.SUCCEEDED)).toBe(false);
    expect(stateMachine.canTransition(PaymentStatus.SUCCEEDED, PaymentStatus.PROCESSING)).toBe(
      false,
    );
    expect(stateMachine.canTransition(PaymentStatus.REFUNDED, PaymentStatus.PENDING)).toBe(false);
  });

  it('treats same-status as allowed (idempotent no-op)', () => {
    expect(stateMachine.canTransition(PaymentStatus.SUCCEEDED, PaymentStatus.SUCCEEDED)).toBe(true);
  });

  it('throws on illegal assertCanTransition', () => {
    expect(() =>
      stateMachine.assertCanTransition(PaymentStatus.FAILED, PaymentStatus.SUCCEEDED),
    ).toThrow(BadRequestException);
  });
});
