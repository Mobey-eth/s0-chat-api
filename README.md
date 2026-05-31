# Senna Chat API

Standalone chat and action-draft service for Senna, the Stage0 assistant.

Senna is scoped to Stage0, RISE, RISE Testnet, EVM wallets, launchpad usage, NFT drops, token creation, token locks, airdrops/multisend, domains, dashboards, and public on-chain verification.

## Features

- `POST /api/chat` chat endpoint with session persistence.
- `GET /api/chat/health` health and corpus-count endpoint.
- PostgreSQL schema under `senna`.
- Docs retrieval over Stage0 GitBook pages, selected RISE docs, and local app facts.
- Rule-based action drafts for:
  - create token
  - create NFT collection
  - create presale
  - lock token
  - airdrop tokens
  - open launchpad/dashboard/routes
- Guest prompt limits and simple rate limiting.
- DeepSeek chat completions.

## Setup

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run docs:sync
npm run dev
```

Required environment:

```bash
DATABASE_URL=postgres://...
DEEPSEEK_API_KEY=...
```

Important optional environment:

```bash
DATABASE_SSL=true
CHAT_CORS_ORIGIN=https://stage0.xyz
STAGE0_DOCS_BASE_URL=https://stagezerolabs.gitbook.io/stage0
RISE_TESTNET_RPC_URL=https://testnet.riselabs.xyz
RISE_TESTNET_CHAIN_ID=11155931
RISE_TESTNET_EXPLORER_URL=https://explorer.testnet.riselabs.xyz
STAGE0_APP_URL=https://stage0.xyz
```

## Request shape

```json
{
  "sessionId": "optional-uuid",
  "mode": "auto",
  "walletAddress": "0x...",
  "evmAddress": "0x...",
  "chainId": 11155931,
  "messages": [
    { "role": "user", "content": "Help me create an NFT collection" }
  ]
}
```

`walletAddress` and `evmAddress` are both treated as EVM identities. `ss58Address` is intentionally not part of Senna because Stage0 uses RISE/EVM flows.

## Database

Run migrations with:

```bash
npm run db:migrate
```

This creates:

- `senna.doc_sources`
- `senna.doc_chunks`
- `senna.chat_sessions`
- `senna.chat_messages`
- `senna.action_drafts`
- `senna.tool_runs`
- `senna.rate_limit_windows`

## Docs Sync

Run:

```bash
npm run docs:sync
```

By default the sync seeds Stage0 GitBook pages, selected RISE docs, and local support files in `docs/support/`.

Override docs seed URLs with comma-separated values:

```bash
STAGE0_DOCS_SEED_URLS=https://stagezerolabs.gitbook.io/stage0/abstract.md,https://docs.risechain.com/docs/builders/testnet-details.mdx
```

## Deployment Notes

- Deploy this as its own API service/repo.
- Set `CHAT_CORS_ORIGIN` to the Stage0 frontend origin.
- Run `npm run build`, then `npm start`.
- Run `npm run db:migrate:prod` before first production start.
- Run `npm run docs:sync` after deploys or docs changes.

## Guardrails

Senna must not request or expose seed phrases, private keys, keystores, API keys, env files, or private infrastructure details.

Senna does not execute transactions. It can prepare action drafts and route users to Stage0 pages. The user signs every transaction in their connected EVM wallet.
