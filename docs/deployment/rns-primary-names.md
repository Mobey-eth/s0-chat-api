# Shared RNS primary names

Release: 2026-09-15. Chain: RISE Mainnet (4153).

## Compatibility

Existing callers keep using `GET https://rns.stage0.xyz/v1/reverse/{address}`.
URLs, query parameters and response fields are unchanged. The Senna reverse
endpoint `/api/public/rns/resolve/address/{address}?chainId=4153` uses the same
selection logic. The public v1 service still accepts GET/OPTIONS only and has
no signer credential or database write privileges.

A valid wallet-selected name takes priority. Otherwise the existing fallback
selects the shortest unexpired name owned by, and resolving to, the address
(then expiry, label and node break ties). No qualifying name returns null.
These choices are API metadata, not onchain reverse records. Contract-only
integrations do not automatically receive this preference.

## Selection and safety

Stage0 requests a gas-free wallet signature through Senna:

- `GET /api/rns/primary/authorization?address=...&name=...&chainId=4153`
- `POST /api/rns/primary` with the authorization fields and signature.

The message binds service, registry, wallet, chain, name, timestamp and current
version. It expires after five minutes (30 seconds of future-clock tolerance).
Verification supports EOAs and smart wallets through viem's public-client
message verification. Both routes share a ten-requests/minute/IP limit.
Signatures are not stored and no transaction is submitted.

Ownership, expiry and forward resolution are checked at a single onchain block
before signing and again before saving. Indexed state must agree. A locked
database compare-and-swap prevents replay, concurrent overwrites and writes
based on an older indexed state. Registry transfers invalidate the former
owner's preference and increment its version. Registration-block binding
prevents a selection reviving after re-registration. Escrowed, released,
expired, transferred or differently resolving names cannot win reverse lookup.

The frontend reads the shared choice, not localStorage. Old browser-only
preferences are not silently migrated; use Make primary and sign to select one.
The retained local cache is only for compatibility with transfer cleanup.

## Data and propagation

Migration `sql/019_rns_primary_name_preferences.sql` adds one table; existing
name and marketplace rows are not rewritten. The read mirror copies that table
with the same chain-scoped transaction as names and marketplace records.
Selections appear on Stage0 after saving. Public mirror updates run every 30
seconds, with existing HTTP cache policy (15 seconds plus stale revalidation).
Transfers also wait for registry indexing. Clients should respect freshness
fields and use onchain ownership for authorization.

## Deployment and rollback

1. Back up the source app schemas and restore-test the archive in isolation.
2. Build the API/mirror/docs images and frontend before switching services.
3. Apply migration 019 to source and mirror in transactions. Existing services
   tolerate the additive table. Verify the mirror reader has SELECT but no
   INSERT/UPDATE/DELETE on it.
4. Restart Senna, the mirror and the public API, then deploy the frontend.
5. Verify health, mirror freshness, unchanged reverse responses and GET-only
   public behavior. Reload the frontend nginx proxy after API recreation so
   its upstream address is refreshed.

For this release, the app-schema archive is retained privately at
`/opt/apps/stage0/backups/primary-20260915/stage0-app-pre-primary.dump`.
Its `senna` and `stage0_rns` schemas restored successfully into isolated
Postgres 17. Migration 019 was replayed there twice. Production name counts
before/after migration: mainnet 168, historical testnet 39; preference rows 0.
This is an app-schema logical backup, not a full Supabase/PITR backup.

Previous frontend assets are retained in that backup directory's `frontend/`.
Previous images have `stage0/{senna-chat-api,rns-api,rns-mirror,developer-docs}:pre-primary-20260915`
tags. Roll back application images/assets together if necessary. Leave the new
table and versions intact; do not drop or reset user choices during rollback.

## Validation

- Frontend: 59 tests, TypeScript, focused ESLint and production build.
- Backend: unit/route tests, TypeScript and production Docker builds.
- `npm run test:rns-primary:db`: seven isolated Postgres checks covering
  idempotent schema creation, preference priority, replay/concurrent updates,
  transfer invalidation, safe fallback, registration binding and chain isolation.
  Requires an explicit loopback `RNS_TEST_DATABASE_URL` ending in
  `/test_rns_primary`; never point fixtures at production.
- Existing ABI encoding/decoding test passes. Full frontend `check:abis` is
  unavailable on this VPS because the Foundry `out/` artifacts are absent.
- No contract, address or environment-file changes; no real-wallet signature
  or onchain transaction used for testing.
