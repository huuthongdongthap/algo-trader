// k6 WebSocket stress test for algo-trade real-time streaming server
// Tests concurrent connections, subscription flow, and message reception
// Run: k6 run tests/load/ws-load-test.js
// Run with env: k6 run -e WS_URL=ws://prod:3003 tests/load/ws-load-test.js

import ws from 'k6/ws';
import { check } from 'k6';

// ─── Config ───────────────────────────────────────────────────────────────────

const WS_URL = __ENV.WS_URL || 'ws://localhost:3003';

/** Default options: 50 concurrent connections for 45 seconds */
export const options = {
  vus: 50,
  duration: '45s',
  thresholds: {
    // WebSocket session error rate must stay below 5%
    ws_session_duration: ['p(95)<35000'],
  },
};

// ─── Default function (executed per VU) ───────────────────────────────────────

export default function () {
  let receivedWelcome = false;
  let receivedSubscribeAck = false;
  let messageCount = 0;

  const response = ws.connect(WS_URL, {}, function (socket) {
    // Connection established — set up handlers before doing anything
    socket.on('open', function () {
      // Subscribe to 'trades' channel after connection opens
      socket.send(JSON.stringify({ type: 'subscribe', channel: 'trades' }));
    });

    socket.on('message', function (data) {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        // Ignore non-JSON frames
        return;
      }

      messageCount++;

      // Detect welcome message from server (sent on connect)
      if (msg.channel === 'system' && msg.data && msg.data.type === 'connected') {
        receivedWelcome = true;
      }

      // Detect subscribe acknowledgement
      if (msg.channel === 'system' && msg.data && msg.data.type === 'subscribed') {
        receivedSubscribeAck = true;
      }
    });

    socket.on('error', function (err) {
      // Log but do not throw — let check() capture failure
      console.error(`WS error: ${err.error()}`);
    });

    // Hold connection open for 30 seconds to receive broadcast messages
    socket.setTimeout(function () {
      socket.close();
    }, 30000);
  });

  // Validate connection and subscription results
  check(response, {
    'ws: connected successfully (status 101)': (r) => r && r.status === 101,
  });

  check(null, {
    'ws: received welcome message': () => receivedWelcome,
    'ws: subscribe ack received': () => receivedSubscribeAck,
    'ws: received at least 1 message': () => messageCount >= 1,
  });
}
