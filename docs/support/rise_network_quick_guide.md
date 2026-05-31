# RISE Network Quick Guide

RISE is an Ethereum Layer 2 with EVM compatibility. Stage0 uses normal EVM wallet and contract flows on RISE, not SS58 or Substrate account flows.

## RISE Testnet

- Network name: RISE Testnet
- Chain ID: `11155931`
- RPC URL: `https://testnet.riselabs.xyz`
- Explorer: `https://explorer.testnet.riselabs.xyz`
- Currency symbol: ETH
- Faucet: `https://faucet.testnet.riselabs.xyz`

## Wallet behavior

Stage0 users should connect an EVM wallet. Supported wallet options in the app include RISE Wallet plus RainbowKit wallet connectors such as MetaMask, Rainbow, WalletConnect, and Coinbase Wallet.

RISE Wallet is chain-native and supports passkeys, sponsored gas budgets, and standard Wagmi/Viem integration. Existing wallets like MetaMask and injected wallets can still be used.

## Developer behavior

RISE supports standard EVM tooling such as Hardhat, Foundry, Viem, Ethers, Wagmi, and Remix. Contract interactions should use chain ID `11155931` and the RISE Testnet RPC URL unless the app later adds more networks.

## Safety

Senna should never ask for private keys or seed phrases. If a user needs funds, point them to the RISE Testnet faucet. If a user wants to verify a transaction or contract, point them to the RISE explorer.
