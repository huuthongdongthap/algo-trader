/**
 * WebSocket hook with 25ms buffering to prevent React re-render storms.
 * Auto-reconnects with exponential backoff (max 30s).
 * Handles: price_update, strategy_status, trade_executed, bot_status, positions
 */
import { useEffect, useRef, useCallback } from 'react';
import { useTradingStore, PriceTick } from '../stores/trading-store';

export function useWebSocketPriceFeed() {
  const bufferRef = useRef<PriceTick[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelayRef = useRef(1000);
  const mountedRef = useRef(true);
  const wsRef = useRef<WebSocket | null>(null);
  const {
    updatePrices, setConnected, setStrategies,
    addTrade, setBotStatus, setPositions, setSpreads,
  } = useTradingStore();

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    const url = import.meta.env.VITE_WS_URL ?? `ws://${window.location.host}/ws`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        retryDelayRef.current = 1000;
        // Request initial state snapshot
        ws.send(JSON.stringify({ type: 'subscribe', channels: ['all'] }));
      };

      ws.onclose = () => {
        setConnected(false);
        if (!mountedRef.current) return;
        const delay = retryDelayRef.current;
        retryDelayRef.current = Math.min(delay * 2, 30_000);
        retryRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => ws.close();

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          switch (data.type) {
            case 'price_update':
              bufferRef.current.push(data.payload ?? data);
              if (!timerRef.current) {
                timerRef.current = setTimeout(() => {
                  updatePrices([...bufferRef.current]);
                  bufferRef.current = [];
                  timerRef.current = null;
                }, 25);
              }
              break;
            case 'strategy_status':
              setStrategies(data.strategies ?? []);
              break;
            case 'trade_executed':
              addTrade(data.trade);
              break;
            case 'bot_status':
              setBotStatus(data.status);
              break;
            case 'positions':
              setPositions(data.positions ?? []);
              break;
            case 'spreads':
              setSpreads(data.spreads ?? []);
              break;
            case 'snapshot':
              // Full state snapshot on connect
              if (data.strategies) setStrategies(data.strategies);
              if (data.botStatus) setBotStatus(data.botStatus);
              if (data.positions) setPositions(data.positions);
              if (data.trades) {
                const store = useTradingStore.getState();
                store.setTrades(data.trades);
              }
              break;
            default:
              // Legacy spread channel support
              if (data.channel === 'spread') {
                bufferRef.current.push(data.payload ?? data);
              }
          }
        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', error);
          /* ignore malformed */ }
      };
    } catch (error) {
      console.error('[WebSocket] Connection failed:', error);
      setConnected(false);
    }
  }, [updatePrices, setConnected, setStrategies, addTrade, setBotStatus, setPositions, setSpreads]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      wsRef.current?.close();
      if (timerRef.current) clearTimeout(timerRef.current);
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [connect]);
}
