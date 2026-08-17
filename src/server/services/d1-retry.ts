/**
 * Defensive helpers for D1 reads.
 *
 * D1 executes statements against a remote storage service that occasionally
 * fails transiently — timeouts, overloaded runners, 5xx — even for small,
 * perfectly valid queries. This surfaced as intermittent 500s on
 * GET /api/chat/conversations/:id against an otherwise healthy database.
 *
 * Reads are idempotent and therefore safe to retry. Writes are deliberately
 * kept outside these helpers: retrying a mutation risks double-application.
 */

const RETRYABLE_PATTERN =
  /(?:timeout|timed\s*out|overloaded|temporarily|try\s+again|service\s+unavailable|internal\s+error|too\s+many\s+concurrent|backoff|unavailable|busy|locked|deadlock|5\d\d)/i;

/** True when a D1 error looks transient rather than a deterministic failure. */
export function isRetryableD1Error(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return RETRYABLE_PATTERN.test(message);
}

export interface RetryOptions {
  /** Total attempts including the first. Defaults to 3. */
  attempts?: number;
  /** Base backoff before the first retry. Defaults to 150 ms. */
  baseDelayMs?: number;
  /** Human-readable label for logs, e.g. "listMessages:activities". */
  label?: string;
}

/**
 * Runs a read-only D1 operation, retrying transient service failures with
 * exponential backoff plus jitter. Deterministic errors (SQL, constraints,
 * missing rows) propagate immediately and unchanged. Each retry is logged so
 * recurring D1 service flakiness is visible in the worker logs.
 */
export async function retryD1Read<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 150;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableD1Error(error)) throw error;
      if (attempt + 1 < attempts) {
        const backoff = baseDelayMs * 2 ** attempt + Math.floor(Math.random() * 40);
        console.warn("D1 transient failure, retrying", {
          label: options.label,
          attempt: attempt + 1,
          of: attempts,
          backoffMs: backoff,
          error: error instanceof Error ? error.message : String(error),
        });
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }
  throw lastError;
}

/**
 * Applies `run` to disjoint slices of `ids`, each bounded to `chunkSize`
 * items. Chunking keeps the number of bind parameters in `IN (...)` clauses
 * well under D1's statement/bind limits regardless of how large `ids` grows.
 */
export async function mapInChunks<T>(ids: readonly string[], chunkSize: number, run: (slice: string[]) => Promise<T>): Promise<T[]> {
  const outputs: T[] = [];
  for (let start = 0; start < ids.length; start += chunkSize) {
    outputs.push(await run(ids.slice(start, start + chunkSize)));
  }
  return outputs;
}