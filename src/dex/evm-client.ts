// EVM chain client using ethers.js v6
// Supports Polygon, Ethereum, Base, Arbitrum via RPC
// Handles wallet management, ERC20 ops, and Uniswap V3 swaps

import { ethers } from 'ethers';

export type EvmChain = 'ethereum' | 'polygon' | 'base' | 'arbitrum';

export interface EvmClientConfig {
  chain: EvmChain;
  rpcUrl: string;
  privateKey: string;
  /** Max gas price in gwei before aborting tx */
  maxGasGwei?: number;
}

export interface SwapParams {
  tokenIn: string;
  tokenOut: string;
  /** Amount in token's smallest unit (wei for ETH) */
  amountIn: bigint;
  /** Slippage tolerance as basis points (100 = 1%) */
  slippageBps: number;
  recipient?: string;
  deadline?: number;
}

export interface SwapResult {
  txHash: string;
  amountIn: bigint;
  amountOutMin: bigint;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
}

// Minimal ERC20 ABI for balance + approve
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

// Uniswap V3 SwapRouter02 - exactInputSingle
const UNISWAP_ROUTER_ABI = [
  `function exactInputSingle(
    (address tokenIn, address tokenOut, uint24 fee,
     address recipient, uint256 amountIn, uint256 amountOutMinimum,
     uint160 sqrtPriceLimitX96) params
  ) payable returns (uint256 amountOut)`,
];

// Uniswap V3 SwapRouter02 addresses per chain
const UNISWAP_ROUTER: Record<EvmChain, string> = {
  ethereum: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
  polygon: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
  base: '0x2626664c2603336E57B271c5C0b26F421741e481',
  arbitrum: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
};

// Default pool fee tier: 0.3%
const DEFAULT_FEE = 3000;
const DEFAULT_MAX_GAS_GWEI = 200;
const GAS_BUFFER_BPS = 120; // 20% buffer on gas estimate

export class EvmClient {
  readonly chain: EvmChain;
  readonly provider: ethers.JsonRpcProvider;
  readonly wallet: ethers.Wallet;
  private readonly maxGasGwei: number;

  constructor(config: EvmClientConfig) {
    this.chain = config.chain;
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);
    this.maxGasGwei = config.maxGasGwei ?? DEFAULT_MAX_GAS_GWEI;
  }

  get address(): string {
    return this.wallet.address;
  }

  /** Get native token balance (ETH/MATIC) in wei */
  async getNativeBalance(): Promise<bigint> {
    return this.provider.getBalance(this.wallet.address);
  }

  /** Get ERC20 token balance in token's smallest unit */
  async getTokenBalance(tokenAddress: string): Promise<bigint> {
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
    return contract.balanceOf(this.wallet.address) as Promise<bigint>;
  }

  /** Approve token spending for Uniswap router */
  async approveToken(tokenAddress: string, amount: bigint): Promise<string> {
    await this.checkGasPrice();
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
    const router = UNISWAP_ROUTER[this.chain];
    const tx = await contract.approve(router, amount);
    await tx.wait();
    return tx.hash as string;
  }

  /** Execute exactInputSingle swap via Uniswap V3 router */
  async swapExactIn(params: SwapParams): Promise<SwapResult> {
    await this.checkGasPrice();

    const router = UNISWAP_ROUTER[this.chain];
    const contract = new ethers.Contract(router, UNISWAP_ROUTER_ABI, this.wallet);

    const deadline = params.deadline ?? Math.floor(Date.now() / 1000) + 300;
    const recipient = params.recipient ?? this.wallet.address;

    // Compute amountOutMinimum with slippage: amountIn * (10000 - slippageBps) / 10000
    // NOTE: This is a simplified estimate; real impl should fetch quote from pool
    const amountOutMin = (params.amountIn * BigInt(10000 - params.slippageBps)) / 10000n;

    const swapCallParams = {
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      fee: DEFAULT_FEE,
      recipient,
      amountIn: params.amountIn,
      amountOutMinimum: amountOutMin,
      sqrtPriceLimitX96: 0n,
    };

    const gasEstimate = await contract.exactInputSingle.estimateGas(swapCallParams);
    const gasLimit = (gasEstimate * BigInt(GAS_BUFFER_BPS)) / 100n;

    const tx = await contract.exactInputSingle(swapCallParams, { gasLimit, deadline });
    const receipt = await tx.wait();

    return {
      txHash: receipt.hash as string,
      amountIn: params.amountIn,
      amountOutMin,
      gasUsed: receipt.gasUsed as bigint,
      effectiveGasPrice: receipt.gasPrice as bigint,
    };
  }

  /** Estimate gas for a swap (in gwei) */
  async estimateSwapGas(params: SwapParams): Promise<{ gasUnits: bigint; gasCostWei: bigint }> {
    const router = UNISWAP_ROUTER[this.chain];
    const contract = new ethers.Contract(router, UNISWAP_ROUTER_ABI, this.wallet);
    const feeData = await this.provider.getFeeData();
    const gasPrice = feeData.gasPrice ?? ethers.parseUnits('50', 'gwei');

    const swapCallParams = {
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      fee: DEFAULT_FEE,
      recipient: params.recipient ?? this.wallet.address,
      amountIn: params.amountIn,
      amountOutMinimum: 0n,
      sqrtPriceLimitX96: 0n,
    };

    const gasUnits = await contract.exactInputSingle.estimateGas(swapCallParams);
    return { gasUnits, gasCostWei: gasUnits * gasPrice };
  }

  /** Abort if current gas price exceeds configured threshold */
  private async checkGasPrice(): Promise<void> {
    const feeData = await this.provider.getFeeData();
    const currentGwei = Number(ethers.formatUnits(feeData.gasPrice ?? 0n, 'gwei'));
    if (currentGwei > this.maxGasGwei) {
      throw new Error(
        `Gas price ${currentGwei.toFixed(1)} gwei exceeds max ${this.maxGasGwei} gwei`
      );
    }
  }
}
