// Solana DEX client stub - @solana/web3.js NOT installed
// Defines interfaces and placeholder functions for architecture completeness
// Install @solana/web3.js to enable real implementation

export interface SolanaClientConfig {
  rpcUrl: string;
  /** Base58-encoded secret key (64 bytes) */
  secretKey: string;
}

export interface SolanaSwapParams {
  /** Input token mint address (base58) */
  inputMint: string;
  /** Output token mint address (base58) */
  outputMint: string;
  /** Amount in lamports or token's smallest unit */
  amount: bigint;
  /** Slippage tolerance in basis points (100 = 1%) */
  slippageBps: number;
  /** Optional destination wallet (default: own wallet) */
  destinationWallet?: string;
}

export interface SolanaSwapResult {
  signature: string;
  inputMint: string;
  outputMint: string;
  inAmount: bigint;
  outAmount: bigint;
  priceImpactPct: number;
}

export interface SolanaTokenAccount {
  mint: string;
  address: string;
  amount: bigint;
  decimals: number;
}

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: number;
  routePlan: Array<{ swapInfo: { ammKey: string; label: string } }>;
}

const NOT_IMPLEMENTED = 'Not implemented - install @solana/web3.js and configure RPC';

/**
 * Solana client stub.
 * All methods throw until @solana/web3.js is installed and this class is implemented.
 *
 * Real implementation should:
 * 1. Use Connection from @solana/web3.js
 * 2. Load Keypair from secretKey
 * 3. Call Jupiter REST API: https://quote-api.jup.ag/v6
 */
export class SolanaClient {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_config: SolanaClientConfig) {
    // Stub: no initialization
  }

  get address(): string {
    throw new Error(NOT_IMPLEMENTED);
  }

  /** Get SOL balance in lamports */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getNativeBalance(): Promise<bigint> {
    throw new Error(NOT_IMPLEMENTED);
  }

  /** Get SPL token balance for a given mint */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getTokenBalance(_mint: string): Promise<bigint> {
    throw new Error(NOT_IMPLEMENTED);
  }

  /** List all SPL token accounts owned by wallet */
  async getTokenAccounts(): Promise<SolanaTokenAccount[]> {
    throw new Error(NOT_IMPLEMENTED);
  }

  /**
   * Get swap quote from Jupiter Aggregator
   * Real impl: GET https://quote-api.jup.ag/v6/quote
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getJupiterQuote(_params: SolanaSwapParams): Promise<JupiterQuote> {
    throw new Error(NOT_IMPLEMENTED);
  }

  /**
   * Execute a swap via Jupiter Aggregator
   * Real impl flow:
   *   1. GET /quote → get best route
   *   2. POST /swap → get transaction bytes
   *   3. Sign transaction with Keypair
   *   4. sendRawTransaction + confirm
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async jupiterSwap(_params: SolanaSwapParams): Promise<SolanaSwapResult> {
    throw new Error(NOT_IMPLEMENTED);
  }

  /**
   * Check if @solana/web3.js is available at runtime
   * Use this guard before calling any method
   */
  static isAvailable(): boolean {
    try {
      // Dynamic require check without importing
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require.resolve('@solana/web3.js');
      return true;
    } catch {
      return false;
    }
  }
}
