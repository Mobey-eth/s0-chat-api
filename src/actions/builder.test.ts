import assert from "node:assert/strict";
import test from "node:test";
import {
  continueActionDraft,
  startQuickAction,
  suggestForDraftField,
} from "./builder.js";

function continueTokenDraft(message: string, draft = startQuickAction("create_token")) {
  assert.ok(draft);
  const next = continueActionDraft(draft, message);
  assert.ok(next);
  return next;
}

test("token wizard keeps a multi-word name separate from its ticker", () => {
  let draft = continueTokenDraft("Launch day");
  assert.equal(draft.prefill.name, "Launch day");
  assert.equal(draft.prefill.symbol, "");
  assert.equal(draft.missingFields[0], "symbol");
  assert.deepEqual(suggestForDraftField(draft), ["LNCH", "LDAY", "LAUNCH"]);

  draft = continueTokenDraft("LNCH", draft);
  assert.equal(draft.prefill.name, "Launch day");
  assert.equal(draft.prefill.symbol, "LNCH");
  assert.equal(draft.missingFields[0], "tokenType");

  draft = continueTokenDraft("Plain", draft);
  draft = continueTokenDraft("100,000,000", draft);
  draft = continueTokenDraft("18", draft);

  assert.deepEqual(draft.missingFields, []);
  assert.equal(draft.summary, 'Create "Launch day" (LNCH) on RISE Mainnet.');
});

test("a one-word token name does not also populate the symbol", () => {
  const draft = continueTokenDraft("Bitcoin");
  assert.equal(draft.prefill.name, "Bitcoin");
  assert.equal(draft.prefill.symbol, "");
  assert.equal(draft.missingFields[0], "symbol");
});

test("confirmation language cannot become an action name", () => {
  const tokenDraft = startQuickAction("create_token");
  const nftDraft = startQuickAction("create_nft");
  assert.ok(tokenDraft);
  assert.ok(nftDraft);
  assert.equal(continueActionDraft(tokenDraft, "start it"), null);
  assert.equal(continueActionDraft(nftDraft, "go ahead"), null);
});

test("a standalone supply does not also populate decimals", () => {
  let draft = continueTokenDraft("Eighteen Token");
  draft = continueTokenDraft("EGTN", draft);
  draft = continueTokenDraft("Plain", draft);
  draft = continueTokenDraft("18", draft);

  assert.equal(draft.prefill.initialSupply, "18");
  assert.equal(draft.missingFields[0], "decimals");
});

test("lock amount and duration answers stay in their own fields", () => {
  let draft = startQuickAction("lock_token");
  assert.ok(draft);
  draft = continueActionDraft(draft, "0x1111111111111111111111111111111111111111");
  assert.ok(draft);
  draft = continueActionDraft(draft, "100");
  assert.ok(draft);

  assert.equal(draft.prefill.amount, "100");
  assert.equal(draft.prefill.duration, "");
  assert.equal(draft.missingFields[0], "durationDays");

  draft = continueActionDraft(draft, "30");
  assert.ok(draft);
  assert.equal(draft.prefill.amount, "100");
  assert.equal(draft.prefill.duration, "30");
  assert.equal(draft.missingFields[0], "lockName");
});

test("airdrop recipients cannot be mistaken for the token contract", () => {
  const recipient = "0x2222222222222222222222222222222222222222";
  const token = "0x1111111111111111111111111111111111111111";
  let draft = startQuickAction("airdrop_tokens");
  assert.ok(draft);
  draft = continueActionDraft(draft, `${recipient},100`);
  assert.ok(draft);

  assert.equal(draft.prefill.token, "");
  assert.equal(draft.prefill.recipientsData, `${recipient},100`);
  assert.equal(draft.missingFields[0], "tokenAddress");

  draft = continueActionDraft(draft, token);
  assert.ok(draft);
  assert.equal(draft.prefill.token, token);
  assert.deepEqual(draft.missingFields, []);
});

test("NFT wizard keeps names, symbols, and URIs separate", () => {
  let draft = startQuickAction("create_nft");
  assert.ok(draft);
  draft = continueActionDraft(draft, "Launch art");
  assert.ok(draft);
  assert.equal(draft.prefill.name, "Launch art");
  assert.equal(draft.prefill.symbol, "");
  assert.deepEqual(suggestForDraftField(draft), ["LNCH", "LART", "LAUNCH"]);

  draft = continueActionDraft(draft, "LART");
  assert.ok(draft);
  draft = continueActionDraft(draft, "ipfs://metadata");
  assert.ok(draft);
  assert.equal(draft.prefill.baseURI, "ipfs://metadata");
  assert.equal(draft.prefill.collectionImageURI, "");

  draft = continueActionDraft(draft, "ipfs://image");
  assert.ok(draft);
  assert.equal(draft.prefill.collectionImageURI, "ipfs://image");
  assert.equal(draft.missingFields[0], "maxSupply");

  draft = continueActionDraft(draft, "1000");
  assert.ok(draft);
  assert.equal(draft.missingFields[0], "mintPrice");
  draft = continueActionDraft(draft, "0.05");
  assert.ok(draft);
  assert.equal(draft.prefill.mintPrice, "0.05");
});

test(".rise registration accepts only the requested name field", () => {
  let draft = startQuickAction("buy_name");
  assert.ok(draft);
  draft = continueActionDraft(draft, "Launch-Day.rise");
  assert.ok(draft);
  assert.equal(draft.prefill.name, "launch-day");
  assert.deepEqual(draft.missingFields, []);
});
