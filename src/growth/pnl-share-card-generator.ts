// P&L share card generator — creates shareable text/HTML cards for social posting
// Used in growth loops: weekly P&L threads on Twitter/Discord/Telegram
import type { PnlSnapshot } from '../core/types.js';

export interface ShareCardData {
  equity: string;
  realizedPnl: string;
  winRate: number;
  tradeCount: number;
  sharpeRatio: number;
  maxDrawdown: number;
  period: 'daily' | 'weekly' | 'monthly';
  tier: number;
  brierScore: number | null;
}

export interface ShareCard {
  text: string;       // Plain text for Twitter/Discord
  html: string;       // HTML card for embedding/OG image
  hashtags: string[];
}

/** Build share card data from a PnlSnapshot + extras */
export function buildShareCardData(
  pnl: PnlSnapshot,
  extras: { sharpeRatio: number; tier: number; brierScore: number | null; period: ShareCardData['period'] },
): ShareCardData {
  const winRate = pnl.tradeCount > 0 ? (pnl.winCount / pnl.tradeCount) * 100 : 0;
  return {
    equity: pnl.equity,
    realizedPnl: pnl.realizedPnl,
    winRate,
    tradeCount: pnl.tradeCount,
    sharpeRatio: extras.sharpeRatio,
    maxDrawdown: pnl.drawdown * 100,
    period: extras.period,
    tier: extras.tier,
    brierScore: extras.brierScore,
  };
}

/** Generate a shareable text + HTML card from P&L data */
export function generateShareCard(data: ShareCardData): ShareCard {
  const pnlSign = parseFloat(data.realizedPnl) >= 0 ? '+' : '';
  const periodLabel = data.period === 'daily' ? 'Today' : data.period === 'weekly' ? 'This Week' : 'This Month';
  const emoji = parseFloat(data.realizedPnl) >= 0 ? '📈' : '📉';
  const brierLine = data.brierScore !== null ? `Brier: ${data.brierScore.toFixed(3)}` : '';

  const text = [
    `${emoji} CashClaw ${periodLabel}`,
    `P&L: ${pnlSign}$${data.realizedPnl}`,
    `Win Rate: ${data.winRate.toFixed(1)}% (${data.tradeCount} trades)`,
    `Sharpe: ${data.sharpeRatio.toFixed(2)} | Max DD: ${data.maxDrawdown.toFixed(1)}%`,
    brierLine,
    `Tier ${data.tier} | Equity: $${data.equity}`,
    '',
    'AI-powered prediction trading on Polymarket',
  ].filter(Boolean).join('\n');

  const pnlColor = parseFloat(data.realizedPnl) >= 0 ? '#2ecc71' : '#e74c3c';

  const html = `
<div style="font-family:'Inter',sans-serif;background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;border-radius:16px;padding:32px;max-width:400px;">
  <div style="font-size:12px;color:#8892b0;text-transform:uppercase;letter-spacing:2px;">CashClaw ${periodLabel}</div>
  <div style="font-size:40px;font-weight:700;color:${pnlColor};margin:8px 0;">${pnlSign}$${data.realizedPnl}</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px;">
    <div><div style="color:#8892b0;font-size:11px;">Win Rate</div><div style="font-size:18px;font-weight:600;">${data.winRate.toFixed(1)}%</div></div>
    <div><div style="color:#8892b0;font-size:11px;">Trades</div><div style="font-size:18px;font-weight:600;">${data.tradeCount}</div></div>
    <div><div style="color:#8892b0;font-size:11px;">Sharpe</div><div style="font-size:18px;font-weight:600;">${data.sharpeRatio.toFixed(2)}</div></div>
    <div><div style="color:#8892b0;font-size:11px;">Max Drawdown</div><div style="font-size:18px;font-weight:600;">${data.maxDrawdown.toFixed(1)}%</div></div>
  </div>
  ${data.brierScore !== null ? `<div style="margin-top:12px;color:#8892b0;font-size:13px;">Prediction Accuracy (Brier): ${data.brierScore.toFixed(3)}</div>` : ''}
  <div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.1);display:flex;justify-content:space-between;align-items:center;">
    <div style="font-size:13px;color:#8892b0;">Tier ${data.tier} | Equity $${data.equity}</div>
    <div style="font-size:11px;color:#64ffda;">cashclaw.cc</div>
  </div>
</div>`.trim();

  const hashtags = ['CashClaw', 'Polymarket', 'AlgoTrading', 'PredictionMarkets'];
  if (parseFloat(data.realizedPnl) >= 0) hashtags.push('Profit');

  return { text, html, hashtags };
}
