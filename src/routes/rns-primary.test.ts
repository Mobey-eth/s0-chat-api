import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerRnsPrimaryRoutes, primaryDependencies } from "./rns-primary.js";
import { PrimaryNameError } from "../rns/primary-name.js";

const address = "0x1111111111111111111111111111111111111111";
const record = { node: `0x${"1".repeat(64)}` as const, selectedBlock: "30000000", registeredBlock: "20079523" };
const body = { address, name: "alice", chainId: 4153, version: "0", timestamp: Date.now(), signature: "0x1234" };
async function setup(overrides: Partial<typeof primaryDependencies> = {}) {
  const app = Fastify();
  await registerRnsPrimaryRoutes(app, {
    version: async () => "0", eligible: async () => record,
    verify: async () => true, save: async () => "1", limit: async () => true,
    ...overrides,
  });
  return app;
}

test("primary authorization normalizes the label and binds wallet, chain, version and name", async () => {
  const app = await setup();
  const response = await app.inject({ url: `/api/rns/primary/authorization?address=${address}&name=Alice.rise&chainId=4153` });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.json().name, "alice");
  assert.match(response.json().message, /Primary name: alice.rise/);
  assert.match(response.json().message, /Chain ID: 4153/);
  assert.match(response.json().message, /Current version: 0/);
  assert.match(response.json().message, /No gas is required/);
  await app.close();
});

test("only authorized eligible selections are saved", async () => {
  let saved: unknown;
  const app = await setup({ save: async (input) => { saved = input; return "1"; } });
  const response = await app.inject({ method: "POST", url: "/api/rns/primary", payload: body });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().primaryName, "alice.rise");
  assert.deepEqual(saved, { ...body, ...record });
  await app.close();
});

test("invalid or replayed authorization cannot change the primary", async () => {
  for (const kind of ["signature", "verification error", "replay", "owner changed"] as const) {
    let saves = 0;
    const app = await setup({
      verify: async () => { if (kind === "verification error") throw new Error("RPC unavailable"); return kind !== "signature"; },
      eligible: async () => { if (kind === "owner changed") throw new PrimaryNameError("Your wallet no longer owns this name."); return record; },
      save: async () => { saves++; return null; },
    });
    const response = await app.inject({ method: "POST", url: "/api/rns/primary", payload: body });
    assert.equal(response.statusCode, kind === "signature" || kind === "verification error" ? 401 : 409);
    assert.equal(saves, kind === "replay" ? 1 : 0);
    await app.close();
  }
});

test("rejects unsupported chains, zero/malformed wallets, malformed labels and signatures", async () => {
  const app = await setup();
  for (const patch of [{ chainId: 11155931 }, { address: "0x0000000000000000000000000000000000000000" }, { address: "bad" }, { name: "bad/name" }, { name: "-bad" }, { signature: "0x1" }, { version: "-1" }]) {
    const response = await app.inject({ method: "POST", url: "/api/rns/primary", payload: { ...body, ...patch } });
    assert.equal(response.statusCode, 400);
  }
  await app.close();
});

test("both routes rate-limit before onchain work", async () => {
  const app = await setup({ limit: async () => false, eligible: async () => { throw new Error("must not run"); } });
  const get = await app.inject({ url: `/api/rns/primary/authorization?address=${address}&name=alice&chainId=4153` });
  const post = await app.inject({ method: "POST", url: "/api/rns/primary", payload: body });
  assert.equal(get.statusCode, 429);
  assert.equal(post.statusCode, 429);
  await app.close();
});

test("unexpected database/RPC failures are not returned to the browser", async () => {
  const app = await setup({ eligible: async () => { throw new Error("sensitive provider connection details"); } });
  const get = await app.inject({ url: `/api/rns/primary/authorization?address=${address}&name=alice&chainId=4153` });
  const post = await app.inject({ method: "POST", url: "/api/rns/primary", payload: body });
  for (const response of [get, post]) {
    assert.equal(response.statusCode, 503);
    assert.doesNotMatch(response.body, /sensitive provider/);
  }
  await app.close();
});
