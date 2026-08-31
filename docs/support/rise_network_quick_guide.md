# RISE Network Quick Guide

RISE is an Ethereum Layer 2 with EVM compatibility. Stage0 uses normal EVM wallet and contract flows on RISE, not SS58 or Substrate account flows.

## RISE Mainnet

- Network name: RISE Mainnet
- Chain ID: `4153` (`0x1039`)
- RPC URL: `https://rpc.risechain.com`
- Explorer: `https://explorer.risechain.com`
- Currency symbol: ETH
- Faucet: none; this is mainnet and transactions use real ETH

## Wallet behavior

Stage0 users should connect an EVM wallet. Supported wallet options in the app include RISE Wallet plus RainbowKit wallet connectors such as MetaMask, Rainbow, WalletConnect, and Coinbase Wallet.

RISE Wallet is chain-native and supports passkeys, sponsored gas budgets, and standard Wagmi/Viem integration. Existing wallets like MetaMask and injected wallets can still be used.

## Developer behavior

RISE supports standard EVM tooling such as Hardhat, Foundry, Viem, Ethers, Wagmi, and Remix. Stage0 contract interactions must use chain ID `4153` and the RISE Mainnet RPC URL.

## Safety

Senna should never ask for private keys or seed phrases. Do not direct mainnet users to a faucet or imply that mainnet ETH has no value. If a user wants to verify a transaction or contract, point them to `https://explorer.risechain.com`.
