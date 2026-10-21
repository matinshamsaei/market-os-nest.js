import { domainEventRetryDelayMs, eventFailureMessage, isDeadEvent } from '../event-retry.policy';

describe('event retry policy', () => {
  it('waits longer after each failed attempt', () => {
    expect(domainEventRetryDelayMs(1)).toBe(1000);
    expect(domainEventRetryDelayMs(2)).toBe(2000);
    expect(domainEventRetryDelayMs(3)).toBe(4000);
    expect(domainEventRetryDelayMs(4)).toBe(8000);
  });

  it('marks an event dead once the attempt count reaches the maximum', () => {
    expect(isDeadEvent(4, 5)).toBe(false);
    expect(isDeadEvent(5, 5)).toBe(true);
  });

  it('reads the error message from a thrown error', () => {
    expect(eventFailureMessage(new Error('Database temporarily unavailable'))).toBe(
      'Database temporarily unavailable',
    );
    expect(eventFailureMessage('nope')).toBe('Unknown event failure');
  });
});
