import assert from "node:assert/strict";
import test from "node:test";
import { PublicRateLimiter } from "./rate-limit.js";

test("PublicRateLimiter enforces and resets a fixed request window", () => {
  const limiter = new PublicRateLimiter(2, 60);
  const now = Date.parse("2026-09-01T00:00:00Z");

  assert.deepEqual(limiter.take("client", now), {
    allowed: true,
    limit: 2,
    remaining: 1,
    resetAt: now + 60_000,
    retryAfterSeconds: 60,
  });
  assert.equal(limiter.take("client", now + 1_000).allowed, true);
  const blocked = limiter.take("client", now + 2_000);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(blocked.retryAfterSeconds, 58);
  assert.equal(limiter.take("client", now + 60_001).allowed, true);
});

test("PublicRateLimiter keeps subjects isolated", () => {
  const limiter = new PublicRateLimiter(1, 60);
  assert.equal(limiter.take("client-a", 0).allowed, true);
  assert.equal(limiter.take("client-a", 1).allowed, false);
  assert.equal(limiter.take("client-b", 1).allowed, true);
});

test("PublicRateLimiter bounds tracked subjects", () => {
  const limiter = new PublicRateLimiter(2, 60, 2);

  limiter.take("oldest", 1_000);
  limiter.take("second", 1_000);
  limiter.take("third", 1_000);

  assert.equal(limiter.take("oldest", 1_001).remaining, 1);
  assert.equal(limiter.take("third", 1_001).remaining, 0);
});
