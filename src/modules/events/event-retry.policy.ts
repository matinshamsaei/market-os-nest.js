export const DOMAIN_EVENT_MAX_ATTEMPTS = 5;
export const DOMAIN_EVENT_RETRY_DELAY_MS = 1000;

export function domainEventRetryDelayMs(attemptCount: number): number {
  return DOMAIN_EVENT_RETRY_DELAY_MS * 2 ** Math.max(attemptCount - 1, 0);
}

export function isDeadEvent(attemptCount: number, maxAttempts: number): boolean {
  return attemptCount >= maxAttempts;
}

export function eventFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unknown event failure';
}
