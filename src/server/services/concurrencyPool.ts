// Runs `fn` over `items` with at most `limit` promises in flight at once.
//
// The app is a single process with no job queue; `middleware/concurrency.ts`
// bounds HTTP request concurrency, not background work. This is the equivalent
// for a batch of outbound calls (e.g. querying SERPRO for many guias) so a
// "consultar em lote" never fires hundreds of requests simultaneously.
//
// Results come back in the same order as `items`. A rejected `fn` rejects the
// whole call (callers that need per-item error handling should catch inside fn).
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const max = Math.max(1, Math.min(limit, items.length || 1));
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: max }, () => worker()));
  return results;
}
