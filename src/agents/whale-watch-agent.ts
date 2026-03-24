// Whale Watch Agent — monitor Polygon CTF contract for large position changes
// Tracks TransferSingle events on Polymarket's CTF Exchange for whale movements
import type { SpecialistAgent, AgentTask, AgentResult } from './agent-base.js';
import { successResult, failResult } from './agent-base.js';
import { logger } from '../core/logger.js';

// Polymarket CTF Exchange on Polygon
const CTF_EXCHANGE = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
const TRANSFER_SINGLE_TOPIC = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';

interface WhaleEvent {
  txHash: string;
  from: string;
  to: string;
  tokenId: string;
  value: string;
  blockNumber: number;
  timestamp: number;
}

export class WhaleWatchAgent implements SpecialistAgent {
  readonly name = 'whale-watch';
  readonly description = 'Monitor Polygon CTF Exchange for whale movements (>$10K TransferSingle events)';
  readonly taskTypes = ['whale-watch' as const];

  canHandle(task: AgentTask): boolean {
    return task.type === 'whale-watch';
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const start = Date.now();
    try {
      const {
        minValueUsdc = 10000,
        blockRange = 500,
      } = task.payload as { minValueUsdc?: number; blockRange?: number };

      const rpcUrl = process.env.POLYGON_RPC_URL;
      if (!rpcUrl) {
        return successResult(this.name, task.id, {
          error: 'POLYGON_RPC_URL not set. Set env var to enable on-chain monitoring.',
          whales: [],
          scanned: 0,
        }, Date.now() - start);
      }

      logger.info(`WhaleWatch: scanning last ${blockRange} blocks for transfers >= $${minValueUsdc}`, 'WhaleWatchAgent');

      const { ethers } = await import('ethers');
      const provider = new ethers.JsonRpcProvider(rpcUrl);

      const latestBlock = await provider.getBlockNumber();
      const fromBlock = latestBlock - blockRange;

      // Query TransferSingle logs from CTF Exchange
      const logs = await provider.getLogs({
        address: CTF_EXCHANGE,
        topics: [TRANSFER_SINGLE_TOPIC],
        fromBlock,
        toBlock: latestBlock,
      });

      const whaleEvents: WhaleEvent[] = [];
      const iface = new ethers.Interface([
        'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)',
      ]);

      for (const log of logs) {
        try {
          const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
          if (!parsed) continue;

          const value = parsed.args[4] as bigint;
          // CTF tokens use 6 decimals (USDC-denominated)
          const usdcValue = Number(value) / 1e6;

          if (usdcValue >= minValueUsdc) {
            whaleEvents.push({
              txHash: log.transactionHash,
              from: parsed.args[1] as string,
              to: parsed.args[2] as string,
              tokenId: (parsed.args[3] as bigint).toString(),
              value: usdcValue.toFixed(2),
              blockNumber: log.blockNumber,
              timestamp: Date.now(), // approximate
            });
          }
        } catch {
          // skip unparseable logs
        }
      }

      whaleEvents.sort((a, b) => b.blockNumber - a.blockNumber);

      return successResult(this.name, task.id, {
        scanned: logs.length,
        whales: whaleEvents.length,
        blockRange: { from: fromBlock, to: latestBlock },
        results: whaleEvents,
        note: whaleEvents.length === 0
          ? `No whale transfers >= $${minValueUsdc} in last ${blockRange} blocks`
          : `Found ${whaleEvents.length} whale movements. Map tokenId to market via CLOB API for context.`,
      }, Date.now() - start);
    } catch (err) {
      return failResult(this.name, task.id, err instanceof Error ? err.message : String(err), Date.now() - start);
    }
  }
}
