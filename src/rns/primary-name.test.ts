import assert from "node:assert/strict";
import test from "node:test";
import { verifyMessage } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { primaryAuthorizationMessage, verifyPrimaryAuthorization, checkPrimaryEligibility } from "./primary-name.js";

test("primary signatures bind every field and reject expired/future/wrong-chain authorizations", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const input = { address: account.address, name: "alice", chainId: 4153, version: "3", timestamp: Date.now() };
  const signature = await account.signMessage({ message: primaryAuthorizationMessage(input) });
  assert.equal(await verifyPrimaryAuthorization({ ...input, signature }, verifyMessage), true);
  for (const patch of [
    { name: "bob" }, { version: "2" }, { chainId: 11155931 },
    { address: "0x1111111111111111111111111111111111111111" },
    { timestamp: input.timestamp - 1 },
  ]) assert.equal(await verifyPrimaryAuthorization({ ...input, ...patch, signature }, verifyMessage), false);
  for (const timestamp of [Date.now() - 301_000, Date.now() + 31_000]) {
    const stale = { ...input, timestamp };
    const staleSignature = await account.signMessage({ message: primaryAuthorizationMessage(stale) });
    assert.equal(await verifyPrimaryAuthorization({ ...stale, signature: staleSignature }, verifyMessage), false);
  }
});

test("primary eligibility enforces live wallet custody, expiry, forward resolution and indexed agreement", async () => {
  const address = "0x1111111111111111111111111111111111111111";
  const onchain = { node: `0x${"1".repeat(64)}`, owner: address, resolvedAddress: address, registered: true, isExpired: false, blockNumber: "30000000" };
  const indexed = { owner: address, resolvedAddress: address, expiry: 9999999999n, createdAtBlock: 20079523n };
  const deps = (chainPatch = {}, dbPatch = {}) => ({
    onchain: async () => ({ ...onchain, ...chainPatch }), indexed: async () => ({ ...indexed, ...dbPatch }),
  }) as unknown as NonNullable<Parameters<typeof checkPrimaryEligibility>[2]>;
  assert.deepEqual(await checkPrimaryEligibility(address, "alice", deps()), { node: onchain.node, selectedBlock: "30000000", registeredBlock: "20079523" });
  for (const patch of [{ registered: false }, { isExpired: true }, { owner: "0x2222222222222222222222222222222222222222" }, { resolvedAddress: null }]) {
    await assert.rejects(checkPrimaryEligibility(address, "alice", deps(patch)));
  }
  for (const patch of [{ owner: "0x2222222222222222222222222222222222222222" }, { resolvedAddress: null }, { expiry: 1n }]) {
    await assert.rejects(checkPrimaryEligibility(address, "alice", deps({}, patch)), /still being indexed/);
  }
});
