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
- `/domains` searches, registers, renews, and manages `.rise` names.
- `/domains/marketplace` shows reserved-name auctions and the secondary marketplace.

## Admin-restricted routes

These routes may only be visible or usable for the configured admin wallet in the current app:

- `/create/token`
- `/create/presale`
- `/tools/token-locker`
- `/tools/airdrop`
- `/admin`
- `/admin/presales`

## RISE Mainnet app configuration

- Network name: RISE Mainnet
- Chain ID: `4153` (`0x1039`)
- RPC URL: `https://rpc.risechain.com`
- Explorer: `https://explorer.risechain.com`
- Native currency: ETH
- There is no faucet on mainnet. Never direct users to a testnet faucet for mainnet activity.

## Deployed Stage0 contracts on RISE Mainnet

- Token factory: `0x80046108E1292E5d142BCbfaaC47069348AaBDe8`
- NFT factory: `0x40Dc4C9655f6273803E0C5F049cFdB1Db026486B`
- NFT factory lens: `0xa0b761A94013FF721fD682eEB7e57709C0e03f42`
- Presale factory: `0x8DB306030Cf163A6C809fB3599500DBE28Df2CC6`
- Token locker: `0x1A93972280714AB50115Ee839C8861CB37A0Ec61`
- Airdrop multisender: `0xDB7C570a0489cd0aab0B24816FEF06Acc4Fc01E8`
- RNS registry: `0x6DDca710993C91402d52061868bE76043a4C5888`
- RNS resolver: `0x36D6383774631565AB0D8F3710748610631A675d`
- RNS registrar: `0xbCA437a93C2E7396a68Ce49BE224F65eE3CFd6Db`
- RNS auction house: `0x0E37994c19980A792B83A106cE03a9b8a9cD40Fc`
- RNS marketplace: `0x323A04F474f80225DE60C1Af13a672796aFA6622`

## Current assistant behavior

Senna can prepare action drafts that point users to Stage0 pages and provide prefill data. Senna does not execute transactions. Users must connect an EVM wallet on RISE Mainnet, review details in the Stage0 app, and sign in their wallet.

For NFT collection profile images and app-level collection profile fields, Stage0 supports backend-managed offchain uploads through Senna. Older collections still resolve images from contract metadata or, when needed, first-token metadata on-chain.

Token profile images and app-level token profile fields in the create-token flow are also stored through Senna and mapped to the token contract address for Stage0 app display.
