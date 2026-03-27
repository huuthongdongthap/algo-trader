# Notification System — Algo-Trader v5.0

Multi-channel alert delivery system for usage monitoring, trading events, and system alerts.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Threshold Alerts Module                            │
│                    (src/middleware/threshold-alerts.ts)                 │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
           ┌────────▼────────┐ ┌───▼────────┐ ┌───▼────────┐
           │  Email Service  │ │ SMS Service│ │Telegram Bot│
           │   (SendGrid)    │ │  (Twilio)  │ │  (grammy)  │
           │  :80% threshold │ │ :90%+ only │ │ :80%+ push │
           └─────────────────┘ └────────────┘ └────────────┘
```

## Channels

| Channel | Provider | Threshold | Use Case | Cost |
|---------|----------|-----------|----------|------|
| Email | SendGrid | 80%+ | Standard alerts | Free tier available |
| SMS | Twilio | 90%+ | Urgent/critical alerts | Per-message |
| Telegram | Bot API | 80%+ | Instant push notifications | Free |

## Environment Variables

### SendGrid (Email)

```bash
# Get API key: https://app.sendgrid.com/settings/api_keys
SENDGRID_API_KEY=SG.your_sendgrid_api_key
SENDGRID_FROM_EMAIL=alerts@yourdomain.com
SENDGRID_FROM_NAME=Algo Trader Alerts
```

### Twilio (SMS)

```bash
# Get credentials: https://console.twilio.com
TWILIO_ACCOUNT_SID=AC_your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1234567890
```

### Telegram Bot

```bash
# Create bot via @BotFather on Telegram, get token
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
```

## Alert Thresholds

| Threshold | Urgency | Channels | Action |
|-----------|---------|----------|--------|
| 80% | WARNING | Email, Telegram | Monitor usage |
| 90% | URGENT | Email, SMS, Telegram | Upgrade recommended |
| 100% | CRITICAL | Email, SMS, Telegram | Upgrade immediately |

## Setup

### 1. SendGrid Setup

1. Create account at https://sendgrid.com
2. Navigate to Settings → API Keys
3. Create API Key with "Full Access" or "Mail Send" permissions
4. Verify sender email in Settings → Sender Authentication
5. Add credentials to `.env`

### 2. Twilio Setup

1. Create account at https://console.twilio.com
2. Get Account SID and Auth Token from Dashboard
3. Purchase a phone number
4. Add credentials to `.env`

### 3. Telegram Bot Setup

1. Message `@BotFather` on Telegram
2. Send `/newbot` command
3. Name your bot (e.g., "Algo Trader Alerts")
4. Copy the bot token to `TELEGRAM_BOT_TOKEN`
5. Start a chat with your bot
6. Get chat ID: `curl "https://api.telegram.org/bot<token>/getUpdates"`
7. Link your license key via `/link <key>` command

## Usage

### Initialize Notification System

```typescript
import { thresholdAlerts } from './middleware/threshold-alerts';

// Initialize all channels
thresholdAlerts.initialize();

// Register recipient for alerts
thresholdAlerts.registerRecipient('license-key-123', {
  email: 'user@example.com',
  phone: '+1234567890',
  telegramChatId: 123456789,
});
```

### Configure Alert Channels

```typescript
// Customize threshold levels per channel
thresholdAlerts.updateChannelConfig({
  email: { enabled: true, minThreshold: 80 },
  sms: { enabled: true, minThreshold: 90 },    // Only critical
  telegram: { enabled: true, minThreshold: 80 },
});
```

### Subscribe to Specific Thresholds

```typescript
import { thresholdAlerts } from './middleware/threshold-alerts';

// 80% warning
thresholdAlerts.onEightyPercent((alert) => {
  console.log('Usage at 80%:', alert);
});

// 90% urgent
thresholdAlerts.onNinetyPercent((alert) => {
  console.log('Usage at 90%:', alert);
});

// 100% critical
thresholdAlerts.onHundredPercent((alert) => {
  console.log('Usage at 100%:', alert);
});
```

### Custom Alert Handler

```typescript
thresholdAlerts.onThreshold(85, async (alert) => {
  // Custom handler for 85% threshold
  await sendSlackNotification(alert);
});
```

## Bot Commands

Telegram bot supports interactive commands:

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/help` | Show help |
| `/status` | Check linked keys |
| `/link <key>` | Link license key |
| `/unlink <key>` | Unlink license key |
| `/notifications` | Toggle alerts |
| `/limits` | View tier limits |

## Rate Limiting

Built-in rate limiting prevents notification spam:

| Channel | Delay | Daily Limit |
|---------|-------|-------------|
| Email | 1 second | Unlimited |
| SMS | 5 seconds | 10 per day |
| Telegram | 1 second | Unlimited |

Rate limiting uses Redis for distributed, crash-resilient tracking.

## Testing

### Trigger Test Alert

```typescript
import { UsageMeteringService } from '../metering/usage-metering-service';

const meteringService = UsageMeteringService.getInstance();

// Simulate threshold breach
meteringService.recordApiCall('test-key');
```

### Manual Test

```bash
# Send test email
curl -X POST http://localhost:3000/admin/test/alert/email \
  -H "Content-Type: application/json" \
  -d '{"to": "test@example.com", "threshold": 90}'

# Send test SMS
curl -X POST http://localhost:3000/admin/test/alert/sms \
  -H "Content-Type: application/json" \
  -d '{"to": "+1234567890", "threshold": 90}'

# Send test Telegram
curl -X POST http://localhost:3000/admin/test/alert/telegram \
  -H "Content-Type: application/json" \
  -d '{"chatId": 123456789, "threshold": 90}'
```

## Alert Message Formats

### Email (HTML)

- Professional HTML template with color-coded urgency
- Progress bar visualization
- Action recommendations
- Plain text fallback included

### SMS

- Concise, character-optimized
- Key truncated to last 8 chars
- Urgency level prefix
- Opt-out instructions

### Telegram

- Markdown formatting with emoji
- Progress bar: `[██████████░] 80%`
- Interactive commands
- Instant delivery

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Email not sending | Verify `SENDGRID_API_KEY`, check sender verification |
| SMS failing | Confirm `TWILIO_ACCOUNT_SID` and phone number format |
| Telegram not responding | Check bot token, ensure bot is started (`/start`) |
| Rate limit errors | Wait for delay period, check Redis connectivity |
| Missing recipient | Call `registerRecipient()` before alert triggers |

## Integration with Monitoring

Notifications integrate with Prometheus/Alertmanager:

```yaml
# infra/alertmanager/alertmanager.yml
receivers:
  - name: 'email'
    email_configs:
      - to: 'alerts@example.com'
        send_resolved: true
  - name: 'telegram'
    telegram_configs:
      - bot_token: 'YOUR_TOKEN'
        chat_id: YOUR_CHAT_ID
  - name: 'sms'
    webhook_configs:
      - url: 'http://alert-webhook:5001/sms'
```

## Best Practices

1. **Use tiered thresholds**: Email at 80%, SMS only at 90%+ (cost control)
2. **Test before production**: Send test alerts to verify configuration
3. **Monitor delivery**: Check logs for failed deliveries
4. **Rotate credentials**: Update API keys periodically
5. **Document escalation**: Define who receives which alerts

## API Reference

### `ThresholdAlerts` Class

| Method | Description |
|--------|-------------|
| `initialize()` | Start all notification channels |
| `registerRecipient(key, recipient)` | Link license to contact info |
| `unregisterRecipient(key)` | Remove recipient |
| `onThreshold(pct, handler)` | Subscribe to threshold |
| `updateChannelConfig(config)` | Update channel settings |
| `dispatchAlert(alert)` | Send multi-channel alert |

### `EmailService` Class

| Method | Description |
|--------|-------------|
| `initialize()` | Setup SendGrid |
| `send(notification)` | Send custom email |
| `sendThresholdAlert(...)` | Send usage alert |
| `setRateLimit(ms)` | Set delay between emails |

### `SmsService` Class

| Method | Description |
|--------|-------------|
| `initialize()` | Setup Twilio |
| `send(notification)` | Send custom SMS |
| `sendThresholdAlert(...)` | Send usage alert |
| `setRateLimit(ms)` | Set delay between SMS |
| `setDailyLimit(n)` | Set max SMS per day |

### `TelegramBotService` Class

| Method | Description |
|--------|-------------|
| `initialize()` | Setup grammy bot |
| `start()` | Start polling |
| `stop()` | Stop polling |
| `sendThresholdAlert(...)` | Send usage alert |
| `linkLicenseKey(userId, key)` | Link key to user |
| `unlinkLicenseKey(userId, key)` | Unlink key |

---

Updated: 2026-03-20
