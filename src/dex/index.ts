// DEX module barrel export
// EVM clients (ethers.js v6), Solana stub, and unified swap router

export { EvmClient } from './evm-client.js';
export type { EvmChain, EvmClientConfig, SwapParams, SwapResult } from './evm-client.js';

export { SolanaClient } from './solana-client.js';
export type {
  SolanaClientConfig,
  SolanaSwapParams,
  SolanaSwapResult,
  SolanaTokenAccount,
  JupiterQuote,
} from './solana-client.js';

export { SwapRouter } from './swap-router.js';
export type {
  SupportedChain,
  ChainConfig,
  UnifiedSwapParams,
  UnifiedSwapResult,
} from './swap-router.js';
