import assert from "node:assert/strict";
import test from "node:test";
import { createStage0RnsApiClient, Stage0RnsApiError } from "./api.js";
import { normalizeRiseName } from "./onchain.js";

test("the REST client encodes names and sends GET only", async () => {
  const requests: Array<{ url: string; method: string | undefined }> = [];
  const client = createStage0RnsApiClient({
    baseUrl: "https://rns.example/v1/",
    fetch: async (input, init) => {
      requests.push({ url: String(input), method: init?.method });
      return new Response(JSON.stringify({ name: "hello world.rise" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  await client.resolveName("hello world.rise");
  assert.deepEqual(requests, [{
    url: "https://rns.example/v1/resolve/hello%20world.rise",
    method: "GET",
  }]);
});

test("the REST client returns structured API errors", async () => {
  const client = createStage0RnsApiClient({
    fetch: async () => new Response(JSON.stringify({
      error: "name_not_found",
      detail: "That name is not registered.",
    }), { status: 404 }),
  });

  await assert.rejects(
    () => client.resolveName("missing.rise"),
    (error) => error instanceof Stage0RnsApiError && error.status === 404 && error.body.error === "name_not_found",
  );
});

test("normalizeRiseName accepts labels and fqdn values", () => {
  assert.deepEqual(normalizeRiseName("Mobi.RISE"), { label: "mobi", name: "mobi.rise" });
  assert.deepEqual(normalizeRiseName("stage-0"), { label: "stage-0", name: "stage-0.rise" });
  assert.throws(() => normalizeRiseName("-bad.rise"), /Invalid/);
});
