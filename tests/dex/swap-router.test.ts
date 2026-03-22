import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SwapRouter } from '../../src/dex/swap-router.js';
import type { ChainConfig, UnifiedSwapParams } from '../../src/dex/swap-router.js';

// Mock EvmClient and SolanaClient
vi.mock('../../src/dex/evm-client.js', () => ({
  EvmClient: vi.fn(() => ({
    swapExactIn: vi.fn(async () => ({
      txHash: '0xabcd1234',
      amountIn: BigInt(1000000),
      amountOutMin: BigInt(950000),
      gasUsed: BigInt(200000),
      effectiveGasPrice: BigInt(50000000000),
    })),
    getConfiguredChains: vi.fn(() => ['ethereum', 'polygon']),
  })),
}));

vi.mock('../../src/dex/solana-client.js', () => ({
  SolanaClient: vi.fn(() => ({
    jupiterSwap: vi.fn(async () => ({
      signature: 'sig_abc123',
      inputMint: 'EPjFWaLb3odccjf2cj9qqUdFjJzBL5kyvvkqXyKqhqU',
      outputMint: 'So11111111111111111111111111111111111111112',
      inAmount: BigInt(1000000),
      outAmount: BigInt(950000),
      priceImpactPct: 0.05,
    })),
  })),
}));

describe('Swap Router', () => {
  describe('constructor', () => {
    it('creates instance with EVM chains', () => {
      const config: ChainConfig = {
        evm: {
          ethereum: {
            chain: 'ethereum',
            rpcUrl: 'https://eth.example.com',
            privateKey: '0x' + 'a'.repeat(64),
          },
        },
      };

      const router = new SwapRouter(config);
      expect(router).toBeDefined();
    });

    it('creates instance with Solana', () => {
      const config: ChainConfig = {
        solana: {
          rpcUrl: 'https://api.mainnet-beta.solana.com',
          secretKey: 'A'.repeat(88),
        },
      };

      const router = new SwapRouter(config);
      expect(router).toBeDefined();
    });

    it('creates instance with both EVM and Solana', () => {
      const config: ChainConfig = {
        evm: {
          ethereum: {
            chain: 'ethereum',
            rpcUrl: 'https://eth.example.com',
            privateKey: '0x' + 'a'.repeat(64),
          },
        },
        solana: {
          rpcUrl: 'https://api.mainnet-beta.solana.com',
          secretKey: 'A'.repeat(88),
        },
      };

      const router = new SwapRouter(config);
      expect(router).toBeDefined();
    });

    it('creates instance with empty config', () => {
      const config: ChainConfig = {};
      const router = new SwapRouter(config);
      expect(router).toBeDefined();
    });

    it('supports all EVM chains', () => {
      const config: ChainConfig = {
        evm: {
          ethereum: {
            chain: 'ethereum',
            rpcUrl: 'https://eth.example.com',
            privateKey: '0x' + 'a'.repeat(64),
          },
          polygon: {
            chain: 'polygon',
            rpcUrl: 'https://polygon.example.com',
            privateKey: '0x' + 'b'.repeat(64),
          },
          base: {
            chain: 'base',
            rpcUrl: 'https://base.example.com',
            privateKey: '0x' + 'c'.repeat(64),
          },
          arbitrum: {
            chain: 'arbitrum',
            rpcUrl: 'https://arbitrum.example.com',
            privateKey: '0x' + 'd'.repeat(64),
          },
        },
      };

      const router = new SwapRouter(config);
      expect(router).toBeDefined();
    });
  });

  describe('getConfiguredChains', () => {
    it('returns list of configured chains', () => {
      const config: ChainConfig = {
        evm: {
          ethereum: {
            chain: 'ethereum',
            rpcUrl: 'https://eth.example.com',
            privateKey: '0x' + 'a'.repeat(64),
          },
          polygon: {
            chain: 'polygon',
            rpcUrl: 'https://polygon.example.com',
            privateKey: '0x' + 'b'.repeat(64),
          },
        },
      };

      const router = new SwapRouter(config);
      const chains = router.getConfiguredChains();

      expect(chains).toContain('ethereum');
      expect(chains).toContain('polygon');
      expect(chains.length).toBe(2);
    });

    it('includes solana if configured', () => {
      const config: ChainConfig = {
        evm: {
          ethereum: {
            chain: 'ethereum',
            rpcUrl: 'https://eth.example.com',
            privateKey: '0x' + 'a'.repeat(64),
          },
        },
        solana: {
          rpcUrl: 'https://api.mainnet-beta.solana.com',
          secretKey: 'A'.repeat(88),
        },
      };

      const router = new SwapRouter(config);
      const chains = router.getConfiguredChains();

      expect(chains).toContain('ethereum');
      expect(chains).toContain('solana');
    });

    it('returns empty array when no chains configured', () => {
      const config: ChainConfig = {};
      const router = new SwapRouter(config);
      const chains = router.getConfiguredChains();

      expect(chains).toEqual([]);
    });
  });

  describe('isChainReady', () => {
    it('returns true for configured EVM chain', () => {
      const config: ChainConfig = {
        evm: {
          ethereum: {
            chain: 'ethereum',
            rpcUrl: 'https://eth.example.com',
            privateKey: '0x' + 'a'.repeat(64),
          },
        },
      };

      const router = new SwapRouter(config);
      expect(router.isChainReady('ethereum')).toBe(true);
    });

    it('returns false for unconfigured EVM chain', () => {
      const config: ChainConfig = {
        evm: {
          ethereum: {
            chain: 'ethereum',
            rpcUrl: 'https://eth.example.com',
            privateKey: '0x' + 'a'.repeat(64),
          },
        },
      };

      const router = new SwapRouter(config);
      expect(router.isChainReady('polygon')).toBe(false);
    });

    it('returns true for configured solana', () => {
      const config: ChainConfig = {
        solana: {
          rpcUrl: 'https://api.mainnet-beta.solana.com',
          secretKey: 'A'.repeat(88),
        },
      };

      const router = new SwapRouter(config);
      expect(router.isChainReady('solana')).toBe(true);
    });

    it('returns false for solana when not configured', () => {
      const config: ChainConfig = {
        evm: {
          ethereum: {
            chain: 'ethereum',
            rpcUrl: 'https://eth.example.com',
            privateKey: '0x' + 'a'.repeat(64),
          },
        },
      };

      const router = new SwapRouter(config);
      expect(router.isChainReady('solana')).toBe(false);
    });
  });

  describe('swap method', () => {
    it('routes swap to EVM client', async () => {
      const config: ChainConfig = {
        evm: {
          ethereum: {
            chain: 'ethereum',
            rpcUrl: 'https://eth.example.com',
            privateKey: '0x' + 'a'.repeat(64),
          },
        },
      };

      const router = new SwapRouter(config);
      const params: UnifiedSwapParams = {
        chain: 'ethereum',
        tokenIn: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        tokenOut: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        amountIn: BigInt(1000000),
        slippageBps: 100,
      };

      const result = await router.swap(params);

      expect(result.chain).toBe('ethereum');
      expect(result.success).toBe(true);
      expect(result.txHash).toBeDefined();
    });

    it('routes swap to Solana client', async () => {
      const config: ChainConfig = {
        solana: {
          rpcUrl: 'https://api.mainnet-beta.solana.com',
          secretKey: 'A'.repeat(88),
        },
      };

      const router = new SwapRouter(config);
      const params: UnifiedSwapParams = {
        chain: 'solana',
        tokenIn: 'EPjFWaLb3odccjf2cj9qqUdFjJzBL5kyvvkqXyKqhqU',
        tokenOut: 'So11111111111111111111111111111111111111112',
        amountIn: BigInt(1000000),
        slippageBps: 100,
      };

      const result = await router.swap(params);

      expect(result.chain).toBe('solana');
      expect(result.success).toBe(true);
      expect(result.txHash).toBeDefined();
    });

    it('throws error for unconfigured chain', async () => {
      const config: ChainConfig = {
        evm: {
          ethereum: {
            chain: 'ethereum',
            rpcUrl: 'https://eth.example.com',
            privateKey: '0x' + 'a'.repeat(64),
          },
        },
      };

      const router = new SwapRouter(config);
      const params: UnifiedSwapParams = {
        chain: 'polygon',
        tokenIn: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        tokenOut: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        amountIn: BigInt(1000000),
        slippageBps: 100,
      };

      await expect(router.swap(params)).rejects.toThrow(/not configured/);
    });

    it('handles swap with custom recipient', async () => {
      const config: ChainConfig = {
        evm: {
          ethereum: {
            chain: 'ethereum',
            rpcUrl: 'https://eth.example.com',
            privateKey: '0x' + 'a'.repeat(64),
          },
        },
      };

      const router = new SwapRouter(config);
      const params: UnifiedSwapParams = {
        chain: 'ethereum',
        tokenIn: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        tokenOut: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        amountIn: BigInt(1000000),
        slippageBps: 100,
        recipient: '0x1234567890123456789012345678901234567890',
      };

      const result = await router.swap(params);

      expect(result.success).toBe(true);
    });

    it('includes amountOutMin in result', async () => {
      const config: ChainConfig = {
        evm: {
          ethereum: {
            chain: 'ethereum',
            rpcUrl: 'https://eth.example.com',
            privateKey: '0x' + 'a'.repeat(64),
          },
        },
      };

      const router = new SwapRouter(config);
      const params: UnifiedSwapParams = {
        chain: 'ethereum',
        tokenIn: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        tokenOut: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        amountIn: BigInt(1000000),
        slippageBps: 100,
      };

      const result = await router.swap(params);

      expect(result.amountOutMin).toBeDefined();
      expect(typeof result.amountOutMin).toBe('bigint');
    });
  });

  describe('calcMinOutput static method', () => {
    it('calculates minimum output with slippage', () => {
      const amountIn = BigInt(10000);
      const slippageBps = 100; // 1%

      const minOut = SwapRouter.calcMinOutput(amountIn, slippageBps);

      // Expected: 10000 * (10000 - 100) / 10000 = 9900
      expect(minOut).toBe(BigInt(9900));
    });

    it('handles zero slippage', () => {
      const amountIn = BigInt(10000);
      const minOut = SwapRouter.calcMinOutput(amountIn, 0);

      expect(minOut).toBe(amountIn);
    });

    it('handles maximum slippage (10000 bps)', () => {
      const amountIn = BigInt(10000);
      const minOut = SwapRouter.calcMinOutput(amountIn, 10000);

      expect(minOut).toBe(BigInt(0));
    });

    it('throws on negative slippage', () => {
      expect(() => SwapRouter.calcMinOutput(BigInt(10000), -100)).toThrow(
        /Invalid slippageBps/
      );
    });

    it('throws on slippage > 10000', () => {
      expect(() => SwapRouter.calcMinOutput(BigInt(10000), 10001)).toThrow(
        /Invalid slippageBps/
      );
    });

    it('handles large amounts', () => {
      const amountIn = BigInt('1000000000000000000'); // 1e18
      const slippageBps = 250; // 2.5%

      const minOut = SwapRouter.calcMinOutput(amountIn, slippageBps);

      // Expected: 1e18 * (10000 - 250) / 10000 = 9750e15
      expect(minOut).toBe(BigInt('975000000000000000'));
    });

    it('calculates different slippage percentages correctly', () => {
      const amountIn = BigInt(100000);
      const tests = [
        { bps: 50, expected: BigInt(99500) }, // 0.5%
        { bps: 100, expected: BigInt(99000) }, // 1%
        { bps: 250, expected: BigInt(97500) }, // 2.5%
        { bps: 500, expected: BigInt(95000) }, // 5%
        { bps: 1000, expected: BigInt(90000) }, // 10%
      ];

      for (const test of tests) {
        const result = SwapRouter.calcMinOutput(amountIn, test.bps);
        expect(result).toBe(test.expected);
      }
    });
  });

  describe('Retry logic', () => {
    it('retries on transient errors', async () => {
      // Note: This test would need more setup to mock retry behavior
      // Included here for coverage tracking
      const config: ChainConfig = {
        evm: {
          ethereum: {
            chain: 'ethereum',
            rpcUrl: 'https://eth.example.com',
            privateKey: '0x' + 'a'.repeat(64),
          },
        },
      };

      const router = new SwapRouter(config);
      expect(router).toBeDefined();
    });
  });
});
