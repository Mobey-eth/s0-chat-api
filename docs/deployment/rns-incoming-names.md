# Incoming names and resolving addresses

## Scope

An ownership transfer remains one Registry `setOwner` transaction. The recipient
can separately choose **Resolving address → Use my wallet** in Stage0 to send one
Resolver `setAddr` transaction. Neither operation changes text records, expiry,
or the shared primary-name preference. No contract or environment changes are
required. Existing third-party `/v1` integrations remain unchanged.

Stage0's Names navigation displays a dot for unacknowledged incoming transfers.
**Received names** links to the notices, where **Check address** opens the resolver
dialog and **Got it** acknowledges a receipt without a wallet prompt.
Acknowledgement is stored per wallet and chain in the current browser. A new
browser can display the same receipts again. Viewing a notice does not dismiss it.

## Storage and API

- Migration `020_rns_incoming_transfers.sql` adds receipt-only
  `stage0_rns.registry_transfers` storage in the source database.
- The existing registry indexer records each Transfer receipt in the same database
  transaction as its ownership update. Onchain ownership remains authoritative.
- `GET /api/public/rns/incoming/:address?chainId=4153` returns at most 100 latest
  receipts for names still owned by the wallet. It uses the existing public RNS
  rate limiter and `Cache-Control: no-store`.
- Registrations, expired/released names and escrow-owned names are excluded.
  Returning a name to the same wallet produces a distinct receipt/notice.
- Stage0 polls every 30 seconds while connected. The existing indexer interval
  also applies, so notices are not instant push notifications.
- This endpoint belongs to Senna, not the external GET-only `/v1` service. The
  public mirror, SDK and developer site require no change.

## Rollout

1. Build the image and preserve the running API image and frontend assets.
2. Back up the source application schemas and validate a restore.
3. Apply migration 020 transactionally before starting the new indexer.
4. Run `npm run rns:backfill-transfers:prod` from the new image to populate
   historical receipts. The backfill is idempotent, stops at the existing registry
   cursor, and does not change owners, cursors or notification dispatches.
5. Start only the new `senna-chat-api` service. If the initial backfill ran before
   this cutover, rerun it afterward to close that indexing gap.
6. Deploy the frontend and reload its nginx upstream after API recreation.
7. Verify incoming results for sender/recipient wallets, API health and existing
   public resolution. Do not send real transactions as part of smoke tests.

For rollback, restore the previous API image and frontend assets. Leave the
additive receipt table in place; no ownership data needs rolling back.

## Checks

`npm test` covers the incoming route. `npm run test:rns-incoming:db` requires
`RNS_TEST_DATABASE_URL` targeting a disposable loopback database named
`test_rns_incoming`; it refuses other targets. Integration coverage includes
repeated migrations, receipt idempotency, registration exclusion, return
transfers, chain/registry isolation, expiry, escrow and out-of-order indexing.

Frontend tests cover acknowledgement isolation/persistence, navbar links,
single-transaction resolver updates, live owner/chain/custody/expiry checks,
wallet rejection, successful receipts, post-receipt verification and refresh.
