/**
 * Retry-delay policy for failed agent runs. Pure function — no IO.
 */

/**
 * Calculate retry delay with exponential backoff and jitter.
 *
 * Jitter prevents the "thundering herd" problem: when multiple agents fail
 * simultaneously (e.g. during an API outage), pure exponential backoff causes
 * them all to retry at the exact same instant, potentially overloading the
 * service again. Adding a random multiplier in [0.5, 1.5) spreads retries
 * across the backoff window.
 *
 * Formula: min(baseDelay * 2^retryCount * (0.5 + random()), maxBackoff)
 */
export function calculateRetryDelay(
  retryCount: number,
  maxBackoffMs: number,
  baseDelay = 10_000,
  random = Math.random,
): number {
  return Math.min(baseDelay * 2 ** retryCount * (0.5 + random()), maxBackoffMs)
}
