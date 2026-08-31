# Senna API Hetzner Deployment Plan

## Goal

Host `senna-chat-api` on the Hetzner CX33 server so the Netlify-hosted Stage0 frontend can use:

- Senna chat
- NFT collection profile images
- token profile images
- app-level collection/token profile info

Actual NFT token metadata and NFT token images must still be read on-chain through `tokenURI`.

## Current Target Topology

```text
Netlify frontend
stage0.xyz
   |
   | calls
   v
https://api.stage0.xyz
   |
   v
Cloudflare DNS and proxy
api.stage0.xyz -> 65.109.170.159
   |
   v
Hetzner CX33
Nginx Proxy Manager
   |
   v
Docker network: proxy
   |
   v
senna-chat-api:3000
   |
   v
Supabase Postgres
```

Use:

- `api.stage0.xyz` for the production API hostname
- Cloudflare for DNS and edge proxying
- Nginx Proxy Manager for HTTPS and reverse proxy management
- Docker Compose for the API runtime
- the current Supabase Postgres database for persistence

Frontend env:

```bash
VITE_SENNA_CHAT_API_URL=https://api.stage0.xyz
```

Backend env:

```bash
STAGE0_API_PUBLIC_URL=https://stage0.xyz
```

## Already Done

These items are already completed based on the current server setup:

- Ubuntu LTS server provisioned on Hetzner
- initial server hardening started/completed
- non-root access path prepared
- SSH/firewall baseline prepared for `22`, `80`, and `443`
- Cloudflare nameservers active for `stage0.xyz`
- Cloudflare DNS record created for `api.stage0.xyz`
- Cloudflare SSL/TLS mode set to `Full`
- Docker installed
- Docker Compose available

Do not redo these unless verification shows one of them is wrong.

## Cloudflare DNS

The domain uses Cloudflare nameservers:

- `kimora.ns.cloudflare.com`
- `mack.ns.cloudflare.com`

DNS records are managed in Cloudflare, not Namecheap.

Expected record:

```text
Type: A
Name: api
IPv4 address: 65.109.170.159
Proxy status: Proxied
TTL: Auto
```

This creates:

```text
api.stage0.xyz -> 65.109.170.159
```

Cloudflare SSL/TLS mode should be:

```text
Full
```

Do not use `Flexible`. Flexible can create redirect loops when the origin also serves HTTPS.

## Server Firewall

Publicly expose only:

- `22` for SSH
- `80` for HTTP challenge/proxy traffic
- `443` for HTTPS

Temporarily expose `81` only while configuring Nginx Proxy Manager:

```bash
sudo ufw allow 81
```

After setup, remove public dashboard access:

```bash
sudo ufw delete allow 81
```

Access Nginx Proxy Manager later through an SSH tunnel:

```bash
ssh -L 8181:localhost:81 <deploy-user>@65.109.170.159
```

Then open locally:

```text
http://localhost:8181
```

## Docker Network

Create one shared Docker network for Nginx Proxy Manager and all app containers:

```bash
docker network create proxy
```

If it already exists, Docker will error with `network with name proxy already exists`; that is fine.

## Install Nginx Proxy Manager

Create the NPM project directory:

```bash
mkdir -p ~/nginx-proxy-manager
cd ~/nginx-proxy-manager
```

Create `docker-compose.yml`:

```yaml
services:
  nginx-proxy-manager:
    image: jc21/nginx-proxy-manager:latest
    container_name: nginx-proxy-manager
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "81:81"
    volumes:
      - ./data:/data
      - ./letsencrypt:/etc/letsencrypt
    networks:
      - proxy

networks:
  proxy:
    external: true
```

Start it:

```bash
docker compose up -d
```

Open during setup:

```text
http://65.109.170.159:81
```

Default first login is usually:

```text
Email: admin@example.com
Password: changeme
```

Change this immediately on first login.

## Deploy Senna API Container

Recommended server path:

```bash
mkdir -p ~/senna-chat-api
cd ~/senna-chat-api
```

Clone or pull the production repo into that directory.

Example:

```bash
git clone https://github.com/Mobey-eth/s0-chat-api.git .
```

## Dockerfile

Use this as the production Dockerfile if the repo does not already include one:

```dockerfile
FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["node", "dist/server.js"]
```

If Node 24 causes any dependency issue, switch to the current Node LTS image used by the project locally.

## Senna API Docker Compose

Create `docker-compose.yml` in `~/senna-chat-api`:

```yaml
services:
  senna-chat-api:
    build: .
    container_name: senna-chat-api
    restart: unless-stopped
    env_file:
      - .env
    expose:
      - "3000"
    networks:
      - proxy

networks:
  proxy:
    external: true
```

Important:

- do not bind `3000` to the public host
- Nginx Proxy Manager reaches the API through the shared `proxy` Docker network
- the public internet only sees ports `80` and `443`

## Production Environment

Create `~/senna-chat-api/.env` on the server.

Use the Supabase Postgres credentials already configured for the project on the server.

Minimum production shape:

```bash
NODE_ENV=production
PORT=3000

DATABASE_URL=postgresql://...
DATABASE_SSL=true

CHAT_CORS_ORIGIN=https://stage0.xyz
CHAT_RATE_LIMIT_WINDOW_SECONDS=60
CHAT_RATE_LIMIT_MAX_REQUESTS=12
CHAT_GUEST_PROMPT_LIMIT=5
CHAT_INPUT_MAX_CHARS=600
CHAT_OUTPUT_MAX_TOKENS_FAST=220
CHAT_OUTPUT_MAX_TOKENS_DEEP=420

STAGE0_API_PUBLIC_URL=https://stage0.xyz
STAGE0_APP_URL=https://stage0.xyz
STAGE0_UPLOAD_MAX_BYTES=2097152

STAGE0_DOCS_BASE_URL=<current Stage0 docs URL used by the project>
STAGE0_DOCS_SEED_URLS=<current Stage0 docs seed URLs used by the project>

RISE_RPC_URL=https://rpc.risechain.com
RISE_CHAIN_ID=4153
RISE_EXPLORER_URL=https://explorer.risechain.com

RNS_REGISTRY_ADDRESS=0x6DDca710993C91402d52061868bE76043a4C5888
RNS_RESOLVER_ADDRESS=0x36D6383774631565AB0D8F3710748610631A675d
RNS_REGISTRAR_ADDRESS=0xbCA437a93C2E7396a68Ce49BE224F65eE3CFd6Db
RNS_AUCTION_HOUSE_ADDRESS=0x0E37994c19980A792B83A106cE03a9b8a9cD40Fc
RNS_MARKETPLACE_ADDRESS=0x323A04F474f80225DE60C1Af13a672796aFA6622
RNS_ADMIN_ADDRESS=0x78d2e9D2B81D94ED27310d61e5f9e1C4db35fba5
RNS_REGISTRY_START_BLOCK=20079518
RNS_RESOLVER_START_BLOCK=20079521
RNS_REGISTRAR_START_BLOCK=20079523
RNS_AUCTION_HOUSE_START_BLOCK=20079526
RNS_MARKETPLACE_START_BLOCK=20079528
RNS_PRICE_SIGNER_PRIVATE_KEY=...

RESEND_API_KEY=...
RESEND_FROM_EMAIL=hello@stage0.xyz
RNS_ADMIN_ACTIVITY_SLACK_WEBHOOK_URL=...

DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL_FAST=deepseek-v4-flash
DEEPSEEK_MODEL_COMPLEX=deepseek-v4-pro
```

Notes:

- `STAGE0_UPLOAD_MAX_BYTES=2097152` enforces the 2MB per-project upload cap.
- Keep `.env` out of git.
- The RNS quote-signer key must derive to the registrar's on-chain `priceSigner`.
- Rotate the quote-signer key and Slack webhook before the public mainnet release if either has appeared in terminal or CI output.
- If the frontend also serves `www.stage0.xyz`, update the API CORS implementation/env later to allow both origins cleanly.

## Database Migrations

Run migrations against Supabase before the API is considered live:

```bash
docker compose run --rm senna-chat-api npm run db:migrate:prod
```

Expected database coverage:

- chat sessions/messages
- rate limit state
- docs/retrieval tables
- NFT collection profile records
- token profile records
- uploaded image/profile metadata
- chain-scoped RNS names, auctions, marketplace activity, reserved inventory, sync cursors, and notification dispatches

After migration, run the read-only release gate:

```bash
docker compose run --rm senna-chat-api npm run rns:check-mainnet:prod
```

Do not start the new container if this reports a failed check. The mainnet
reserved-name rows are initially disabled so migration cannot accidentally
publish them.

The database should store project-level profile images and project info only.

Do not store or source actual NFT token image data from the database. Token metadata/images remain on-chain reads.

## Docs Sync

Seed or refresh Senna's retrieval corpus:

```bash
docker compose run --rm senna-chat-api npm run docs:sync
```

Run this:

- once during first production deploy
- after docs URL/source changes
- after meaningful Stage0 docs changes

It does not need to run on every deploy.

## Start The API

Build and start:

```bash
docker compose up -d --build
```

Check containers:

```bash
docker ps
```

Expected containers:

```text
nginx-proxy-manager
senna-chat-api
```

Check logs:

```bash
docker logs -f senna-chat-api
```

## Nginx Proxy Manager Host

In the Nginx Proxy Manager dashboard:

```text
Hosts -> Proxy Hosts -> Add Proxy Host
```

Details tab:

```text
Domain Names: api.stage0.xyz
Scheme: http
Forward Hostname / IP: senna-chat-api
Forward Port: 3000
Cache Assets: off
Block Common Exploits: on
Websockets Support: on
```

Use `senna-chat-api`, not `65.109.170.159`, because Nginx Proxy Manager and the API are on the same Docker network.

SSL tab:

```text
Request a new SSL Certificate: on
Force SSL: on
HTTP/2 Support: on
HSTS: off for now
Email: your email
I Agree to the Let's Encrypt Terms: checked
```

Save the proxy host.

Expected public API:

```text
https://api.stage0.xyz
```

## Netlify Frontend

Set this Netlify environment variable:

```bash
VITE_SENNA_CHAT_API_URL=https://api.stage0.xyz
```

Then redeploy the frontend.

Do not call these from the browser:

```text
http://65.109.170.159:3000
http://65.109.170.159
```

The frontend should only call:

```text
https://api.stage0.xyz
```

## Verification Checklist

API health:

```bash
curl https://api.stage0.xyz/api/chat/health
```

Expected:

- HTTP 200
- healthy response
- no CORS/preflight issue from the frontend
- docs/retrieval status if exposed by the health endpoint

Chat test:

```bash
curl -X POST https://api.stage0.xyz/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"hello","mode":"fast"}'
```

Expected:

- Senna responds
- response references Stage0/Rise correctly
- no QFPad/QF network leakage

Frontend checks:

- chat bubble sends messages to `https://api.stage0.xyz`
- reset messages still work
- fast/deep modes work
- NFT creation can save description, website, socials, and collection profile image
- token creation can save description, website, socials, and token profile image
- `/tokens` shows uploaded token profile images
- dashboard created-token cards show uploaded token profile images
- NFT collection cards prefer uploaded collection profile image, then fall back to on-chain metadata
- actual NFT token metadata/images still resolve from on-chain `tokenURI`
- files above 2MB return a clear rejection, ideally HTTP `413`

## Deploy Update Flow

Typical app update:

```bash
cd ~/senna-chat-api
git pull
docker compose build
docker compose run --rm senna-chat-api npm run db:migrate:prod
docker compose run --rm senna-chat-api npm run rns:check-mainnet:prod
docker compose run --rm senna-chat-api npm run docs:sync
docker compose up -d
```

Check after deploy:

```bash
docker logs --tail=100 senna-chat-api
curl https://api.stage0.xyz/api/chat/health
```

## Rollback Flow

If a deploy breaks:

```bash
cd ~/senna-chat-api
git log --oneline -5
git checkout <last-good-commit>
docker compose up -d --build
```

If a migration caused the issue, do not guess a DB rollback. Inspect the migration and Supabase state first.

## Backups

Because the database is Supabase Postgres:

- rely on Supabase backups as the first line of defense
- periodically export logical backups if profile data becomes important
- keep `.env` and deployment secrets backed up outside git

If moving Postgres onto the Hetzner server later, add:

- daily `pg_dump`
- off-server backup storage
- restore test procedure
- disk usage monitoring

## Multiple Services Later

More APIs can share the same Hetzner server and Nginx Proxy Manager.

Example:

```text
api.stage0.xyz  -> senna-chat-api:3000
api.bookree.com -> bookree-api:3000
api.other.com   -> other-api:3000
```

Each service can listen on internal port `3000` because each one is isolated in its own container.

Only Nginx Proxy Manager needs public ports `80` and `443`.

## Final Recommendation

Use this as the near-term production baseline:

- `api.stage0.xyz`
- Cloudflare proxied A record to `65.109.170.159`
- Cloudflare SSL/TLS mode `Full`
- Nginx Proxy Manager on the Hetzner server
- Docker network `proxy`
- Dockerized `senna-chat-api`
- Supabase Postgres
- 2MB upload cap enforced by the API
- Netlify frontend calling only `https://api.stage0.xyz`

This keeps the deployment simple while leaving room to add more Stage0 services on the same server later.
