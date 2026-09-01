# Stage0 Public RNS API

## Scope

The public RNS API is a read-only integration boundary for `.rise` names on RISE Mainnet. It is intentionally separate from `api.stage0.xyz` and never registers names, creates signed quotes, constructs transactions, or exposes Senna and Stage0 admin routes.

Public hostnames:

- API: `https://rns.stage0.xyz`
- Documentation: `https://developers.stage0.xyz`

The first API version accepts `GET` and CORS `OPTIONS` requests only under `/v1`.

## Runtime topology

```text
Cloudflare -> Nginx Proxy Manager -> stage0-rns-api:3001
                                      | direct reads -> RISE Mainnet RPC
                                      |
                                      v
                              stage0-rns-postgres
                                      ^
                                      |
                              stage0-rns-mirror
                                      ^
                                      |
                       authoritative Supabase RNS tables

Cloudflare -> Nginx Proxy Manager -> stage0-developer-docs:80
```

`senna-chat-api` remains the only RNS indexer. The mirror worker never runs index jobs and the public API never writes indexed state.

## Isolation model

- `stage0-rns-postgres` is attached only to the private `stage0-rns-data` Docker network and publishes no host port.
- The mirror worker receives only the generated writer credential and the source Supabase URL.
- The public API receives only the generated reader credential.
- The reader role has `SELECT` on the `stage0_rns` mirror schema and no `INSERT`, `UPDATE`, or `DELETE` privileges.
- Writer and reader credentials live in separate Docker volumes and are generated on the VPS, not committed or copied into application environment files.
- The public API container is read-only, drops Linux capabilities, has resource limits, and does not receive chat, signer, Slack, Resend, upload, or LLM credentials.
- The docs container is a static read-only Nginx service.

## Mirror behavior

The mirror takes a transactionally consistent snapshot of the six public RNS tables every 30 seconds:

- `sync_state`
- `names`
- `primary_auctions`
- `marketplace_listings`
- `marketplace_auctions`
- `marketplace_events`

Each local replacement happens in one Postgres transaction, so API readers see either the previous complete snapshot or the next complete snapshot. Public traffic never changes the number of Supabase queries. The API health response includes mirror age, duration, and source row counts and reports `degraded` when the mirror is more than 120 seconds stale.

This full-snapshot strategy is appropriate for the initial mainnet inventory. Replace it with incremental CDC or logical replication before table volume makes a 30-second full snapshot inefficient.

The mirror database contains only reconstructible onchain/indexed public data. Its Docker volume can be rebuilt from Supabase; it is not an authoritative backup of production.

## Local operations

Build and start the public stack:

```bash
docker compose up -d --build stage0-rns-api stage0-developer-docs
```

Inspect status:

```bash
docker compose ps \
  stage0-rns-postgres \
  stage0-rns-reader-init \
  stage0-rns-mirror \
  stage0-rns-api \
  stage0-developer-docs

docker logs --tail=100 stage0-rns-mirror
docker logs --tail=100 stage0-rns-api
```

The one-shot `stage0-rns-secrets` and `stage0-rns-reader-init` containers should exit successfully. The database, mirror, API, and docs containers should be healthy.

## DNS and reverse proxy cutover

Create the records only after the internal services pass validation:

```text
rns.stage0.xyz         A  65.109.170.159  DNS only
developers.stage0.xyz  A  65.109.170.159  DNS only
```

Add Nginx Proxy Manager hosts:

```text
rns.stage0.xyz         -> http://stage0-rns-api:3001
developers.stage0.xyz  -> http://stage0-developer-docs:80
```

Issue Let's Encrypt certificates, enable Force SSL and HTTP/2, validate both public hosts, then switch the Cloudflare records to Proxied.

Cloudflare must not present interactive Managed Challenge pages for `rns.stage0.xyz/v1/*`. Keep WAF rules and Cloudflare rate limiting enabled, and bypass only browser-interactive challenges for the API hostname/path.

## Release checks

- `GET /v1/health` returns chain `4153`, five jobs, and a fresh mirror timestamp.
- `GET /v1/network` returns the canonical five RNS contract addresses.
- `GET /v1/availability/stage0.rise` returns policy `protected`.
- `POST /v1/network` returns HTTP `405`.
- A partner-origin CORS preflight returns `Access-Control-Allow-Origin: *` without credentials.
- `/api/chat/health`, creator application routes, uploads, admin routes, and quote routes return `404` on the RNS service.
- The database reader role has SELECT only.
- The Postgres container has no published ports.
- The OpenAPI file at `https://developers.stage0.xyz/openapi.yaml` passes validation.
