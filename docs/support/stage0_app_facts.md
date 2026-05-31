# Stage0 App Facts

Stage0 is a launchpad and token lifecycle app for the RISE network. Senna should use these facts as local app context when answering product questions.

## Public routes

- `/` is the homepage.
- `/presales` lists live and past launchpad projects, including token and NFT launches.
- `/presales/:address` shows a token presale detail page.
- `/nfts/:address` shows an NFT collection detail and mint page.

## Wallet routes

- `/dashboard` shows connected wallet activity and creator/participant views.
- `/tools` lists Stage0 tools.
- `/create/nft` deploys NFT collections on RISE.
- `/nfts/manage/:address` manages an NFT collection.
- `/presales/manage/:address` manages a presale.
- `/project/:address` shows project details.
- `/tokens` lists created tokens.
- `/my-nfts` shows owned NFTs.
- `/locks/:id` shows a lock detail page.

## Admin-restricted routes

These routes may only be visible or usable for the configured admin wallet in the current app:

- `/domains`
- `/create/token`
- `/create/presale`
- `/tools/token-locker`
- `/tools/airdrop`
- `/admin`
- `/admin/presales`
- `/admin/whitelist`

## RISE testnet app configuration

- Network name: RISE Testnet
- Chain ID: `11155931`
- RPC URL: `https://testnet.riselabs.xyz`
- Explorer: `https://explorer.testnet.riselabs.xyz`
- Native currency: ETH

## Deployed Stage0 contracts on RISE Testnet

- Token factory: `0xa0b761A94013FF721fD682eEB7e57709C0e03f42`
- NFT factory: `0xCEA1A715927408216B838DcAcd90Dff025Ab0b2D`
- NFT factory lens: `0x5F52461ac88ea4a9095A2eD82743Df17E1a1c1af`
- Presale factory: `0x67064a9236050D3d947d7F5Bd3448BD4b5D947FC`
- Token locker: `0xb225cb8Ea90E0ab1F9f5011d31fD217083c31fc7`
- Airdrop multisender: `0x8DB306030Cf163A6C809fB3599500DBE28Df2CC6`

## Current assistant behavior

Senna can prepare action drafts that point users to Stage0 pages and provide prefill data. Senna does not execute transactions. Users must connect an EVM wallet, review details in the Stage0 app, and sign in their wallet.

For NFT collection images, Stage0 expects collection image URIs that can be normalized from a CID, `ipfs://` URI, or `https://` URL. If a collection does not have explicit contract image metadata, the app can fall back to reading the first token metadata image on-chain where available.

Token image uploads in the create-token flow are preview/staging only until storage or database wiring is added.
