import {
  PermanentPaymentError,
  PaymentRetryPolicy,
  TransientPaymentError,
} from '../payment-retry.policy';

describe('PaymentRetryPolicy', () => {
  it('retries transient failures and eventually succeeds', async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    const policy = new PaymentRetryPolicy({ maxAttempts: 3, baseDelayMs: 10, sleep });
    const operation = jest
      .fn()
      .mockRejectedValueOnce(new TransientPaymentError('Gateway timeout'))
      .mockRejectedValueOnce(new TransientPaymentError('Gateway timeout'))
      .mockResolvedValueOnce('ok');

    await expect(policy.execute(operation)).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not retry permanent failures', async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    const policy = new PaymentRetryPolicy({ maxAttempts: 3, baseDelayMs: 10, sleep });
    const operation = jest.fn().mockRejectedValue(new PermanentPaymentError('Card declined'));

    await expect(policy.execute(operation)).rejects.toThrow(PermanentPaymentError);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('stops after max attempts for transient failures', async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    const policy = new PaymentRetryPolicy({ maxAttempts: 2, baseDelayMs: 5, sleep });
    const operation = jest.fn().mockRejectedValue(new TransientPaymentError('timeout'));

    await expect(policy.execute(operation)).rejects.toThrow(TransientPaymentError);
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
