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

test("a standalone supply does not also populate decimals", () => {
  let draft = continueTokenDraft("Eighteen Token");
  draft = continueTokenDraft("EGTN", draft);
  draft = continueTokenDraft("Plain", draft);
  draft = continueTokenDraft("18", draft);

  assert.equal(draft.prefill.initialSupply, "18");
  assert.equal(draft.missingFields[0], "decimals");
});
