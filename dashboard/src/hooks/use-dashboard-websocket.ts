/**
 * WebSocket hook for dashboard real-time updates
 * Subscribes to signal updates, P&L changes, and admin events
 */
import { useEffect, useRef, useCallback } from 'react';
import { useDashboardStore } from '../stores/dashboard-store';
import { useTradingStore } from '../stores/trading-store';

export function useDashboardWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const mountedRef = useRef(true);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(1000);

  const { setSignals, setMetrics, setAdminStatus } = useDashboardStore();
  const { setConnected: setWsConnected } = useTradingStore();

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    const wsUrl = import.meta.env.VITE_WS_URL ?? `ws://${window.location.host}/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[Dashboard WS] Connected');
        setWsConnected(true);
        reconnectDelayRef.current = 1000;

        // Subscribe to dashboard channels
        ws.send(JSON.stringify({
          type: 'subscribe',
          channels: ['signals', 'pnl', 'admin', 'health'],
        }));
      };

      ws.onclose = () => {
        console.log('[Dashboard WS] Disconnected');
        setWsConnected(false);

        if (!mountedRef.current) return;

        // Reconnect with exponential backoff (max 30s)
        const delay = Math.min(reconnectDelayRef.current, 30000);
        reconnectDelayRef.current = delay * 2;
        reconnectTimeoutRef.current = setTimeout(connect, delay);
      };

      ws.onerror = (error) => {
        console.error('[Dashboard WS] Error:', error);
        ws.close();
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          switch (message.type) {
            case 'signals_update':
              if (message.data) {
                setSignals(message.data);
              }
              break;

            case 'pnl_update':
              if (message.metrics) {
                setMetrics(message.metrics);
              }
              break;

            case 'admin_update':
              if (message.status) {
                setAdminStatus(message.status);
              }
              break;

            case 'health_update':
              // Health updates are handled separately via polling
              break;

            case 'snapshot':
              // Full state snapshot on connect
              if (message.signals) setSignals(message.signals);
              if (message.metrics) setMetrics(message.metrics);
              if (message.adminStatus) setAdminStatus(message.adminStatus);
              break;

            default:
              // Pass through to trading store for legacy support
              break;
          }
        } catch (error) {
          console.error('[Dashboard WS] Failed to parse message:', error);
        }
      };
    } catch (error) {
      console.error('[Dashboard WS] Connection failed:', error);
      setWsConnected(false);
    }
  }, [setWsConnected, setSignals, setMetrics, setAdminStatus]);

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
    };
  }, [connect]);

  return {
    connected: wsRef.current?.readyState === WebSocket.OPEN,
    reconnect: connect,
  };
}
