/**
 * Unified real-time WebSocket hook for dashboard updates.
 * Handles: P&L, positions, spread opportunities, admin events, health status.
 * Features: 25ms buffering, latency tracking, auto-reconnect (exponential backoff).
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import { useDashboardStore } from '../stores/dashboard-store';
import { useTradingStore } from '../stores/trading-store';

export interface LatencyMetrics {
  lastLatency: number;
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
}

export interface RealtimeUpdatesState {
  connected: boolean;
  latency: LatencyMetrics;
  error: string | null;
  reconnectCount: number;
}

export function useRealtimeUpdates(): RealtimeUpdatesState & { reconnect: () => void } {
  const [connected, setConnected] = useState(false);
  const [latency, setLatency] = useState<LatencyMetrics>({
    lastLatency: 0,
    avgLatency: 0,
    minLatency: Infinity,
    maxLatency: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [reconnectCount, setReconnectCount] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const mountedRef = useRef(true);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(1000);
  const latencySamplesRef = useRef<number[]>([]);

  const bufferRef = useRef<Record<string, unknown[]>>({});
  const timerRef = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({});

  const { setSignals, setMetrics, setAdminStatus } = useDashboardStore();
  const {
    setConnected: setWsConnected,
    setPositions,
    setSpreads,
    setTrades,
    setStrategies,
    setBotStatus,
  } = useTradingStore();

  const updateLatency = useCallback((latencyMs: number) => {
    setLatency((prev) => {
      const samples = latencySamplesRef.current;
      samples.push(latencyMs);
      if (samples.length > 100) samples.shift(); // Keep last 100 samples

      const avg = samples.reduce((a, b) => a + b, 0) / samples.length;

      return {
        lastLatency: latencyMs,
        avgLatency: Math.round(avg),
        minLatency: Math.min(prev.minLatency, latencyMs),
        maxLatency: Math.max(prev.maxLatency, latencyMs),
      };
    });
  }, []);

  const flushBuffer = useCallback((channel: string) => {
    const items = bufferRef.current[channel];
    if (!items || items.length === 0) return;

    const data = [...items];
    bufferRef.current[channel] = [];
    timerRef.current[channel] = null;

    switch (channel) {
      case 'pnl':
        setMetrics(data as any);
        break;
      case 'positions':
        setPositions(data as any);
        break;
      case 'spreads':
        setSpreads(data as any);
        break;
      case 'trades':
        setTrades(data as any);
        break;
      case 'strategies':
        setStrategies(data as any);
        break;
      case 'bot_status':
        setBotStatus(data as any);
        break;
      case 'signals':
        setSignals(data as any);
        break;
      case 'admin':
        setAdminStatus(data as any);
        break;
    }
  }, [setMetrics, setPositions, setSpreads, setTrades, setStrategies, setBotStatus, setSignals, setAdminStatus]);

  const queueUpdate = useCallback((channel: string, data: unknown) => {
    if (!bufferRef.current[channel]) {
      bufferRef.current[channel] = [];
    }
    bufferRef.current[channel].push(data);

    // Flush after 25ms buffer window
    if (!timerRef.current[channel]) {
      timerRef.current[channel] = setTimeout(() => {
        flushBuffer(channel);
      }, 25);
    }
  }, [flushBuffer]);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    const wsUrl = import.meta.env.VITE_WS_URL ?? `ws://${window.location.host}/ws`;
    const connectTime = Date.now();

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        const connectionLatency = Date.now() - connectTime;
        console.log('[RealtimeUpdates] Connected in', connectionLatency, 'ms');
        setConnected(true);
        setError(null);
        setWsConnected(true);
        setReconnectCount(0);
        reconnectDelayRef.current = 1000;

        // Subscribe to all channels
        ws.send(JSON.stringify({
          type: 'subscribe',
          channels: ['pnl', 'positions', 'spreads', 'trades', 'strategies', 'bot_status', 'signals', 'admin', 'health'],
        }));

        // Request initial snapshot
        ws.send(JSON.stringify({ type: 'snapshot_request' }));
      };

      ws.onclose = () => {
        console.log('[RealtimeUpdates] Disconnected');
        setConnected(false);
        setWsConnected(false);

        if (!mountedRef.current) return;

        // Exponential backoff with max 30s
        const delay = Math.min(reconnectDelayRef.current, 30000);
        reconnectDelayRef.current = delay * 2;
        setReconnectCount((c) => c + 1);
        reconnectTimeoutRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        console.error('[RealtimeUpdates] Error');
        setError('Connection error - reconnecting...');
        ws.close();
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          const serverTime = message.timestamp ?? Date.now();
          const clientTime = Date.now();
          const latencyMs = clientTime - serverTime;

          // Track latency for relevant message types
          if (message.type && !message.type.includes('ack')) {
            updateLatency(latencyMs);
          }

          switch (message.type) {
            case 'pnl_update':
              queueUpdate('pnl', message.metrics ?? message.data);
              break;
            case 'position_update':
              queueUpdate('positions', message.positions ?? message.data);
              break;
            case 'spread_update':
              queueUpdate('spreads', message.spreads ?? message.data);
              break;
            case 'trade_update':
              queueUpdate('trades', message.trades ?? message.data);
              break;
            case 'strategy_update':
              queueUpdate('strategies', message.strategies ?? message.data);
              break;
            case 'bot_status_update':
              queueUpdate('bot_status', message.status ?? message.data);
              break;
            case 'signal_update':
              queueUpdate('signals', message.signals ?? message.data);
              break;
            case 'admin_update':
              queueUpdate('admin', message.status ?? message.data);
              break;
            case 'health_update':
              // Health updates handled separately
              break;
            case 'snapshot':
              // Full state snapshot on connect
              if (message.pnl) setMetrics(message.pnl);
              if (message.positions) setPositions(message.positions);
              if (message.spreads) setSpreads(message.spreads);
              if (message.trades) setTrades(message.trades);
              if (message.strategies) setStrategies(message.strategies);
              if (message.botStatus) setBotStatus(message.botStatus);
              if (message.signals) setSignals(message.signals);
              if (message.adminStatus) setAdminStatus(message.adminStatus);
              break;
            case 'ack':
              // Acknowledgment - skip latency tracking
              break;
            default:
              // Legacy support - pass through to trading store
              if (message.channel) {
                queueUpdate(message.channel, message.data ?? message.payload);
              }
          }
        } catch (parseError) {
          console.error('[RealtimeUpdates] Failed to parse message:', parseError);
        }
      };
    } catch (connectionError) {
      console.error('[RealtimeUpdates] Connection failed:', connectionError);
      setConnected(false);
      setWsConnected(false);
      setError('Connection failed - retrying...');
    }
  }, [setWsConnected, setMetrics, setPositions, setSpreads, setTrades, setStrategies, setBotStatus, setSignals, setAdminStatus, updateLatency, queueUpdate]);

  const reconnect = useCallback(() => {
    console.log('[RealtimeUpdates] Manual reconnect triggered');
    if (wsRef.current) {
      wsRef.current.close();
    }
    reconnectDelayRef.current = 1000;
    setReconnectCount(0);
    connect();
  }, [connect]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      Object.values(timerRef.current).forEach((timer) => {
        if (timer) clearTimeout(timer);
      });
    };
  }, [connect]);

  return {
    connected,
    latency: {
      ...latency,
      minLatency: latency.minLatency === Infinity ? 0 : latency.minLatency,
    },
    error,
    reconnectCount,
    reconnect,
  };
}
