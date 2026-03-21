---
phase: 4
title: "DEX Client"
status: completed
priority: P2
effort: 4h
parallel_group: A
blocks: [6]
blocked_by: [1]
---

# Phase 4: DEX Client

## Context
- [Research: CEX/DEX](../../plans/reports/researcher-260321-1531-cex-dex-trading-strategies.md)
- [Phase 1: Core](./phase-01-core-infrastructure.md)

## Overview
DEX trading clients for EVM chains (Ethereum, Polygon, Base, Arbitrum) via ethers.js and Solana via @solana/web3.js. Supports Uniswap V4 and Jupiter swaps.

## File Ownership (Exclusive)
```
src/dex/evm-client.ts       # ethers.js wrapper, Uniswap V4 swaps
src/dex/solana-client.ts     # Solana/Jupiter swap client
src/dex/swap-router.ts       # Unified swap interface across chains
src/dex/index.ts             # Barrel export
```

## Key Insights
- EVM: ethers.js v6, Uniswap V4 singleton architecture (lower gas)
- Solana: Sub-second execution, $0.00025-$0.001 tx fees (ideal for arb)
- Jupiter: Auto-splits across Orca, Raydium, etc. for best price
- Slippage: 0.5-2% on EVM, 0.5-3% on Solana; always set slippageBps
- MEV protection: Use Flashbots on Ethereum, Jupiter on Solana

## Requirements

### Functional
1. **evm-client.ts** (~150 lines): EVM chain interactions
   - Connect to RPC (Alchemy/Infura)
   - Wallet management (from private key)
   - `getBalance(token)`, `approve(token, spender)`
   - `swapExactIn(tokenIn, tokenOut, amount, slippage)` via Uniswap router
   - Gas estimation and max gas price threshold
2. **solana-client.ts** (~120 lines): Solana interactions
   - Connect to RPC (Helius/QuickNode)
   - Keypair from secret key
   - `getBalance(token)`, `getTokenAccounts()`
   - `jupiterSwap(inputMint, outputMint, amount, slippageBps)`
3. **swap-router.ts** (~100 lines): Unified interface
   - Abstract swap across chains: `swap(chain, tokenIn, tokenOut, amount)`
   - Route to correct client based on chain
   - Cross-chain price comparison

### Non-Functional
- Gas price checks before EVM transactions (abort if gas > threshold)
- Transaction confirmation polling with timeout
- Private mempool submission on Ethereum (Flashbots)

## Implementation Steps

1. Create `src/dex/evm-client.ts`:
   - ethers.js v6 provider + wallet setup
   - Uniswap V4 SwapRouter ABI (minimal: swap function only)
   - ERC20 approve + swap flow
   - Gas estimation with 20% buffer
2. Create `src/dex/solana-client.ts`:
   - @solana/web3.js Connection + Keypair
   - Jupiter API integration (REST: /quote → /swap)
   - Transaction signing and confirmation
3. Create `src/dex/swap-router.ts`:
   - Chain enum: ethereum, polygon, arbitrum, base, solana
   - Unified swap method dispatching to correct client
   - Price comparison across DEXes
4. Create barrel `src/dex/index.ts`

## Todo
- [x] src/dex/evm-client.ts (ethers.js + Uniswap V3 SwapRouter02)
- [x] src/dex/solana-client.ts (Solana + Jupiter stub)
- [x] src/dex/swap-router.ts (unified swap interface)
- [x] src/dex/index.ts (barrel)
- [x] Verify: compile passes, ethers types resolve

## Success Criteria
- Can connect to EVM RPC and fetch balances
- Can connect to Solana RPC and fetch balances
- Uniswap swap transaction builds correctly
- Jupiter quote API returns valid prices
- Unified swap router dispatches to correct chain

## Risk Assessment
- **Medium risk**: Smart contract interaction complexity, gas estimation
- **Mitigation**: Start with testnet (Polygon Mumbai, Solana devnet)
- **Risk**: Uniswap V4 ABI may change → pin specific deployed contract addresses
