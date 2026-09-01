export interface PublicRateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

interface RateLimitWindow {
  hits: number;
  resetAt: number;
}

export class PublicRateLimiter {
  private readonly windows = new Map<string, RateLimitWindow>();

  constructor(
    private readonly limit: number,
    private readonly windowSeconds: number,
    private readonly maxSubjects = 10_000,
  ) {}

  take(subject: string, now = Date.now()): PublicRateLimitResult {
    this.prune(now);
    const existing = this.windows.get(subject);
    const resetAt = existing && existing.resetAt > now
      ? existing.resetAt
      : now + this.windowSeconds * 1_000;
    const hits = existing && existing.resetAt > now ? existing.hits + 1 : 1;

    if (!existing && this.windows.size >= this.maxSubjects) {
      const oldestSubject = this.windows.keys().next().value;
      if (oldestSubject) this.windows.delete(oldestSubject);
    }
    this.windows.set(subject, { hits, resetAt });

    const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1_000));
    return {
      allowed: hits <= this.limit,
      limit: this.limit,
      remaining: Math.max(0, this.limit - hits),
      resetAt,
      retryAfterSeconds,
    };
  }

  private prune(now: number) {
    if (this.windows.size < 1_000) return;
    for (const [subject, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(subject);
    }
  }
}
