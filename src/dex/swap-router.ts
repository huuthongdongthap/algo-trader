// Unified swap router - routes swaps to correct chain client (EVM or Solana)
// Provides chain-agnostic interface with slippage calculation and retry logic

import { EvmClient, EvmClientConfig, SwapParams, SwapResult } from './evm-client.js';
import { SolanaClient, SolanaClientConfig, SolanaSwapParams, SolanaSwapResult } from './solana-client.js';
import type { EvmChain } from './evm-client.js';

export type SupportedChain = EvmChain | 'solana';

export interface ChainConfig {
  evm?: Record<EvmChain, EvmClientConfig>;
  solana?: SolanaClientConfig;
}

export interface UnifiedSwapParams {
  chain: SupportedChain;
  tokenIn: string;
  tokenOut: string;
  /** Amount in token's smallest unit */
  amountIn: bigint;
  /** Slippage tolerance in basis points (100 = 1%) */
  slippageBps: number;
  recipient?: string;
}

export interface UnifiedSwapResult {
  chain: SupportedChain;
  txHash: string;
  amountIn: bigint;
  amountOutMin: bigint;
  success: boolean;
}

const EVM_CHAINS = new Set<SupportedChain>(['ethereum', 'polygon', 'base', 'arbitrum']);
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isEvmChain(chain: SupportedChain): chain is EvmChain {
  return EVM_CHAINS.has(chain);
}

export class SwapRouter {
  private evmClients = new Map<EvmChain, EvmClient>();
  private solanaClient: SolanaClient | null = null;

  constructor(config: ChainConfig) {
    // Initialize EVM clients for configured chains
    if (config.evm) {
      for (const [chain, clientConfig] of Object.entries(config.evm) as [EvmChain, EvmClientConfig][]) {
        this.evmClients.set(chain, new EvmClient(clientConfig));
      }
    }

    // Initialize Solana client if configured
    if (config.solana) {
      this.solanaClient = new SolanaClient(config.solana);
    }
  }

  /** Execute a swap on the specified chain with retry logic */
  async swap(params: UnifiedSwapParams): Promise<UnifiedSwapResult> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        if (isEvmChain(params.chain)) {
          return await this.swapEvm(params);
        } else {
          return await this.swapSolana(params);
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Do not retry on gas price or auth errors
        if (lastError.message.includes('exceeds max') || lastError.message.includes('Not implemented')) {
          break;
        }

        if (attempt < MAX_RETRY_ATTEMPTS) {
          await sleep(RETRY_DELAY_MS * attempt);
        }
      }
    }

    throw lastError ?? new Error('Swap failed after retries');
  }

  /** Route swap to the correct EVM chain client */
  private async swapEvm(params: UnifiedSwapParams): Promise<UnifiedSwapResult> {
    const chain = params.chain as EvmChain;
    const client = this.evmClients.get(chain);
    if (!client) {
      throw new Error(`EVM client not configured for chain: ${chain}`);
    }

    const swapParams: SwapParams = {
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn,
      slippageBps: params.slippageBps,
      recipient: params.recipient,
    };

    const result: SwapResult = await client.swapExactIn(swapParams);

    return {
      chain: params.chain,
      txHash: result.txHash,
      amountIn: result.amountIn,
      amountOutMin: result.amountOutMin,
      success: true,
    };
  }

  /** Route swap to Solana/Jupiter client */
  private async swapSolana(params: UnifiedSwapParams): Promise<UnifiedSwapResult> {
    if (!this.solanaClient) {
      throw new Error('Solana client not configured');
    }

    const swapParams: SolanaSwapParams = {
      inputMint: params.tokenIn,
      outputMint: params.tokenOut,
      amount: params.amountIn,
      slippageBps: params.slippageBps,
      destinationWallet: params.recipient,
    };

    const result: SolanaSwapResult = await this.solanaClient.jupiterSwap(swapParams);

    return {
      chain: 'solana',
      txHash: result.signature,
      amountIn: result.inAmount,
      amountOutMin: result.outAmount,
      success: true,
    };
  }

  /** Calculate expected output accounting for slippage */
  static calcMinOutput(amountIn: bigint, slippageBps: number): bigint {
    if (slippageBps < 0 || slippageBps > 10000) {
      throw new Error(`Invalid slippageBps: ${slippageBps}. Must be 0-10000`);
    }
    return (amountIn * BigInt(10000 - slippageBps)) / 10000n;
  }

  /** Check if a chain client is configured and ready */
  isChainReady(chain: SupportedChain): boolean {
    if (isEvmChain(chain)) return this.evmClients.has(chain);
    return this.solanaClient !== null;
  }

  /** Get list of configured chains */
  getConfiguredChains(): SupportedChain[] {
    const chains: SupportedChain[] = [...this.evmClients.keys()];
    if (this.solanaClient) chains.push('solana');
    return chains;
  }
}
