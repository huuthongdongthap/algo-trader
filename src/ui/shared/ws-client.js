/* CashClaw — WebSocket client with auto-reconnect + exponential backoff
 * Updates all .cc-ws-dot elements automatically based on connection state.
 */

const STATUS_CLASSES = {
  connected: 'cc-ws-dot--live',
  connecting: 'cc-ws-dot--connecting',
  error: 'cc-ws-dot--error',
  stale: 'cc-ws-dot--stale',
};

let ws = null;
let status = 'stale';
let reconnectAttempts = 0;
let reconnectTimer = null;
let staleTimer = null;
const handlers = {};

const MAX_RECONNECT_DELAY = 30000;
const STALE_TIMEOUT = 60000;

/** Update all .cc-ws-dot elements to reflect current status */
function updateDots() {
  const dots = document.querySelectorAll('.cc-ws-dot');
  dots.forEach((dot) => {
    Object.values(STATUS_CLASSES).forEach((cls) => dot.classList.remove(cls));
    dot.classList.add(STATUS_CLASSES[status] || STATUS_CLASSES.stale);
  });
}

/** Reset the stale timer — called on every message received */
function resetStaleTimer() {
  clearTimeout(staleTimer);
  staleTimer = setTimeout(() => {
    status = 'stale';
    updateDots();
  }, STALE_TIMEOUT);
}

/** Emit event to registered handlers */
function emit(event, data) {
  const list = handlers[event];
  if (!list) return;
  for (const fn of list) {
    try { fn(data); } catch (e) { console.error(`[ws] handler error for "${event}":`, e); }
  }
}

/**
 * Connect to a WebSocket URL.
 * Automatically reconnects on disconnect with exponential backoff.
 */
export function connect(url) {
  if (ws) {
    ws.close();
    ws = null;
  }

  status = 'connecting';
  updateDots();

  try {
    ws = new WebSocket(url);
  } catch (e) {
    status = 'error';
    updateDots();
    scheduleReconnect(url);
    return;
  }

  ws.onopen = () => {
    status = 'connected';
    reconnectAttempts = 0;
    updateDots();
    resetStaleTimer();
    emit('open', null);
  };

  ws.onmessage = (event) => {
    resetStaleTimer();
    try {
      const data = JSON.parse(event.data);
      const type = data.type || 'message';
      emit(type, data);
      emit('message', data);
    } catch {
      emit('message', event.data);
    }
  };

  ws.onerror = () => {
    status = 'error';
    updateDots();
  };

  ws.onclose = () => {
    status = 'error';
    updateDots();
    clearTimeout(staleTimer);
    emit('close', null);
    scheduleReconnect(url);
  };
}

/** Schedule a reconnect with exponential backoff */
function scheduleReconnect(url) {
  clearTimeout(reconnectTimer);
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
  reconnectAttempts++;
  reconnectTimer = setTimeout(() => connect(url), delay);
}

/**
 * Register a handler for an event type.
 * Built-in events: 'open', 'close', 'message'
 * Custom events: matched by parsed JSON `type` field
 */
export function on(event, handler) {
  if (!handlers[event]) handlers[event] = [];
  handlers[event].push(handler);
}

/** Get current connection status */
export function getStatus() {
  return status;
}
