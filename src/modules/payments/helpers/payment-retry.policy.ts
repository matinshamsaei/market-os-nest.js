export class TransientPaymentError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TransientPaymentError';
  }
}

export class PermanentPaymentError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PermanentPaymentError';
  }
}

export function isTransientPaymentError(error: unknown): boolean {
  if (error instanceof TransientPaymentError) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('network') ||
    message.includes('temporarily unavailable') ||
    message.includes('503') ||
    message.includes('429')
  );
}

export interface PaymentRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class PaymentRetryPolicy {
  constructor(private readonly options: PaymentRetryOptions = {}) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    const maxAttempts = this.options.maxAttempts ?? 3;
    const baseDelayMs = this.options.baseDelayMs ?? 100;
    const sleep =
      this.options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

    let attempt = 0;
    let lastError: unknown;

    while (attempt < maxAttempts) {
      attempt += 1;

      try {
        return await operation();
      } catch (error) {
        lastError = error;

        if (!isTransientPaymentError(error) || attempt >= maxAttempts) {
          throw error;
        }

        await sleep(baseDelayMs * 2 ** (attempt - 1));
      }
    }

    throw lastError;
  }
}
