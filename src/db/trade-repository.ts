/**
 * Trade Repository
 * Database operations for trades
 */

import { query, transaction } from './postgres-client';
import { ExecutionResult } from '../execution/order-executor';
import { ArbitrageOpportunity } from '../arbitrage/spread-detector';

export interface TradeRecord {
  id: string;
  opportunity_id: string;
  execution_id: string;
  symbol: string;
  buy_exchange: string;
  sell_exchange: string;
  buy_price: number;
  sell_price: number;
  amount: number;
  spread_percent: number;
  profit: number;
  fee: number;
  status: string;
  created_at: number;
  updated_at: number;
}

export class TradeRepository {
  /**
   * Insert trade record
   */
  async insert(
    opportunity: ArbitrageOpportunity,
    execution: ExecutionResult
  ): Promise<void> {
    const sql = `
      INSERT INTO trades (
        id, opportunity_id, execution_id, symbol,
        buy_exchange, sell_exchange,
        buy_price, sell_price, amount,
        spread_percent, profit, fee,
        status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        profit = EXCLUDED.profit,
        updated_at = EXCLUDED.updated_at
    `;

    const params = [
      execution.id,
      opportunity.id,
      execution.id,
      opportunity.symbol,
      opportunity.buyExchange,
      opportunity.sellExchange,
      opportunity.buyPrice,
      opportunity.sellPrice,
      execution.buyOrder?.amount || 0,
      opportunity.spreadPercent,
      execution.profit || 0,
      (execution.buyOrder?.fee || 0) + (execution.sellOrder?.fee || 0),
      execution.status,
      execution.timestamp,
      Date.now(),
    ];

    await query(sql, params);
  }

  /**
   * Get trade by ID
   */
  async getById(id: string): Promise<TradeRecord | null> {
    const sql = 'SELECT * FROM trades WHERE id = $1';
    const result = await query(sql, [id]);
    return (result.rows[0] as unknown as TradeRecord) || null;
  }

  /**
   * Get trades by status
   */
  async getByStatus(status: string): Promise<TradeRecord[]> {
    const sql = 'SELECT * FROM trades WHERE status = $1 ORDER BY created_at DESC';
    const result = await query(sql, [status]);
    return result.rows as unknown as TradeRecord[];
  }

  /**
   * Get recent trades
   */
  async getRecent(limit = 100): Promise<TradeRecord[]> {
    const sql = `
      SELECT * FROM trades
      ORDER BY created_at DESC
      LIMIT $1
    `;
    const result = await query(sql, [limit]);
    return result.rows as unknown as TradeRecord[];
  }

  /**
   * Update trade status
   */
  async updateStatus(id: string, status: string, profit?: number): Promise<void> {
    const sql = `
      UPDATE trades
      SET status = $1,
          profit = COALESCE($2, profit),
          updated_at = $3
      WHERE id = $4
    `;
    await query(sql, [status, profit, Date.now(), id]);
  }

  /**
   * Get total PnL
   */
  async getTotalPnl(): Promise<number> {
    const sql = 'SELECT SUM(profit) as total FROM trades WHERE status = $1';
    const result = await query<{ total: string }>(sql, ['FILLED']);
    return parseFloat(result.rows[0]?.total || '0');
  }

  /**
   * Get PnL by date range
   */
  async getPnlByDateRange(
    startDate: number,
    endDate: number
  ): Promise<{ date: string; profit: number; tradeCount: number }[]> {
    const sql = `
      SELECT
        DATE_TRUNC('day', TO_TIMESTAMP(created_at / 1000)) as date,
        SUM(profit) as profit,
        COUNT(*) as trade_count
      FROM trades
      WHERE created_at BETWEEN $1 AND $2
        AND status = 'FILLED'
      GROUP BY DATE_TRUNC('day', TO_TIMESTAMP(created_at / 1000))
      ORDER BY date
    `;

    const result = await query(sql, [startDate, endDate]);
    return result.rows.map((row) => ({
      date: String(row.date),
      profit: parseFloat(row.profit as string),
      tradeCount: parseInt(row.trade_count as string),
    }));
  }

  /**
   * Delete old trades
   */
  async deleteOlderThan(timestamp: number): Promise<void> {
    const sql = 'DELETE FROM trades WHERE created_at < $1';
    await query(sql, [timestamp]);
  }
}
