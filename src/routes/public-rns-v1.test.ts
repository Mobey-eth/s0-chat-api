import assert from "node:assert/strict";
import test from "node:test";
import { buildPublicRnsApp } from "../public-rns-app.js";
import type { PublicRnsV1Dependencies } from "./public-rns-v1.js";

const onchainRecord = {
  chainId: 4_153,
  network: "RISE Mainnet",
  node: `0x${"1".repeat(64)}`,
  label: "alice",
  name: "alice.rise",
  owner: "0x1111111111111111111111111111111111111111",
  resolver: "0x2222222222222222222222222222222222222222",
  resolvedAddress: "0x3333333333333333333333333333333333333333",
  expiry: "1800000000",
  isExpired: false,
  registered: true,
  available: false,
  policy: { id: 0, name: "open" },
  publicRegistrationAvailable: false,
  blockNumber: "20650000",
  source: "onchain",
};

function dependencies(overrides: Partial<PublicRnsV1Dependencies> = {}) {
  return {
    health: async () => ({ status: "ok", service: "stage0-rns-api", chainId: 4_153 }),
    onchainName: async () => onchainRecord,
    indexedName: async () => null,
    reverse: async (address: string) => ({ chainId: 4_153, address, primaryName: null }),
    namesForAddress: async (address: string) => ({ chainId: 4_153, owner: address, count: 0, names: [] }),
    pricing: async () => ({ chainId: 4_153 }),
    primaryAuctions: async () => [],
    marketplaceListings: async () => [],
    marketplaceAuctions: async () => [],
    marketplaceActivity: async () => [],
    ...overrides,
  } as unknown as PublicRnsV1Dependencies;
}

test("GET /v1/resolve returns an onchain resolution", async () => {
  const app = await buildPublicRnsApp(dependencies());
  const response = await app.inject({ method: "GET", url: "/v1/resolve/alice.rise" });
  await app.close();

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().name, "alice.rise");
  assert.equal(response.json().address, onchainRecord.resolvedAddress);
  assert.equal(response.json().source, "onchain");
  assert.match(response.headers["cache-control"] ?? "", /max-age=15/);
  assert.equal(response.headers["access-control-allow-credentials"], undefined);
});

test("GET /v1/resolve rejects invalid and unavailable names", async () => {
  const app = await buildPublicRnsApp(dependencies({
    onchainName: async () => ({ ...onchainRecord, registered: false }),
  } as unknown as Partial<PublicRnsV1Dependencies>));
  const invalid = await app.inject({ method: "GET", url: "/v1/resolve/-bad.rise" });
  const missing = await app.inject({ method: "GET", url: "/v1/resolve/unused.rise" });
  await app.close();

  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error, "invalid_name");
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error, "name_not_found");
});

test("the v1 API allows browser GETs and refuses mutations", async () => {
  const app = await buildPublicRnsApp(dependencies());
  const preflight = await app.inject({
    method: "OPTIONS",
    url: "/v1/network",
    headers: {
      origin: "https://partner.example",
      "access-control-request-method": "GET",
    },
  });
  const mutation = await app.inject({ method: "POST", url: "/v1/network" });
  const sennaRoute = await app.inject({ method: "GET", url: "/api/chat/health" });
  await app.close();

  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers["access-control-allow-origin"], "*");
  assert.equal(mutation.statusCode, 405);
  assert.equal(mutation.json().error, "method_not_allowed");
  assert.equal(mutation.headers.allow, "GET, OPTIONS");
  assert.equal(sennaRoute.statusCode, 404);
});

test("GET list endpoints return a stable envelope", async () => {
  const app = await buildPublicRnsApp(dependencies({
    marketplaceListings: async () => [{ listingId: "7" }] as never,
  }));
  const response = await app.inject({ method: "GET", url: "/v1/marketplace/listings?limit=10" });
  const invalidLimit = await app.inject({ method: "GET", url: "/v1/marketplace/listings?limit=101" });
  await app.close();

  assert.deepEqual(response.json(), {
    chainId: 4_153,
    count: 1,
    items: [{ listingId: "7" }],
  });
  assert.equal(invalidLimit.statusCode, 400);
  assert.equal(invalidLimit.json().error, "invalid_query");
});
