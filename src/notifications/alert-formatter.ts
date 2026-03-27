/**
 * Alert Formatter
 * Shared formatting logic for threshold alerts across all notification channels
 * DRY: Consolidates duplicated formatting from email, SMS, and Telegram services
 */

export interface AlertData {
  licenseKey: string;
  threshold: number;
  currentUsage: number;
  dailyLimit: number;
  percentUsed: number;
}

export interface FormattedAlert {
  urgency: string;
  urgencyColor: string;
  emoji: string;
  shortKey: string;
  actionMessage: string;
}

/**
 * Calculate urgency level based on threshold percentage
 */
export function getUrgency(threshold: number): string {
  if (threshold >= 100) return 'CRITICAL';
  if (threshold >= 90) return 'URGENT';
  return 'WARNING';
}

/**
 * Get urgency color for HTML emails
 */
export function getUrgencyColor(threshold: number): string {
  if (threshold >= 100) return '#dc3545';
  if (threshold >= 90) return '#fd7e14';
  return '#ffc107';
}

/**
 * Get emoji for Telegram and visual alerts
 */
export function getEmoji(threshold: number): string {
  if (threshold >= 100) return '🚨';
  if (threshold >= 90) return '🔴';
  return '⚠️';
}

/**
 * Get action message based on threshold severity
 */
export function getActionMessage(threshold: number): string {
  if (threshold >= 100) {
    return 'You have reached or exceeded your daily limit. Overage charges are being applied. Consider upgrading immediately.';
  } else if (threshold >= 90) {
    return 'Your usage is critically close to the daily limit. Overage charges may apply. Upgrade recommended.';
  } else {
    return 'Your usage is approaching the daily limit. Monitor closely to avoid overage charges.';
  }
}

/**
 * Get short action message for SMS (character-limited)
 */
export function getShortActionMessage(threshold: number): string {
  if (threshold >= 100) {
    return 'LIMIT REACHED. Overage charges applying. Upgrade now.';
  } else if (threshold >= 90) {
    return 'LIMIT NEAR. Upgrade recommended to avoid overage.';
  }
  return 'Monitor usage to avoid overage charges.';
}

/**
 * Get Telegram-specific action message with emoji
 */
export function getTelegramActionMessage(threshold: number): string {
  if (threshold >= 100) {
    return '🚨 LIMIT REACHED! Overage charges are being applied. Upgrade immediately.';
  } else if (threshold >= 90) {
    return '🔴 CRITICAL! Very close to limit. Upgrade recommended.';
  }
  return '⚠️ Warning: Usage approaching limit. Monitor closely.';
}

/**
 * Generate progress bar for visual displays
 */
export function generateProgressBar(percentUsed: number, segments: number = 20): string {
  const filled = Math.round((percentUsed / 100) * segments);
  const empty = segments - filled;
  return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
}

/**
 * Generate Telegram-style progress bar (10 segments)
 */
export function generateTelegramProgressBar(percentUsed: number): string {
  const filled = Math.round(percentUsed / 10);
  const empty = 10 - filled;
  return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
}

/**
 * Get truncated license key (last 8 characters)
 */
export function getShortKey(licenseKey: string): string {
  return licenseKey.slice(-8);
}

/**
 * Format complete alert data into unified object
 */
export function formatAlert(data: AlertData): FormattedAlert {
  return {
    urgency: getUrgency(data.threshold),
    urgencyColor: getUrgencyColor(data.threshold),
    emoji: getEmoji(data.threshold),
    shortKey: getShortKey(data.licenseKey),
    actionMessage: getActionMessage(data.threshold),
  };
}

/**
 * Format email subject line
 */
export function formatEmailSubject(threshold: number): string {
  const urgency = getUrgency(threshold);
  return `[${urgency}] Usage Alert: ${threshold}% threshold reached`;
}

/**
 * Format SMS body message
 */
export function formatSmsBody(data: AlertData): string {
  const { urgency, shortKey } = formatAlert(data);
  const action = getShortActionMessage(data.threshold);

  return `ALGO TRADER [${urgency}]
Key: *${shortKey}
Usage: ${data.currentUsage}/${data.dailyLimit} (${data.percentUsed.toFixed(0)}%)
${action}
Reply STOP to opt out`;
}

/**
 * Format Telegram message body (Markdown)
 */
export function formatTelegramMessage(data: AlertData): string {
  const { emoji, urgency, shortKey } = formatAlert(data);
  const progressBar = generateTelegramProgressBar(data.percentUsed);
  const actionMessage = getTelegramActionMessage(data.threshold);

  return `
${emoji} *${urgency} - Usage Alert*

Key: \`${shortKey}\`
Threshold: ${data.threshold}%
Usage: ${data.currentUsage.toLocaleString()} / ${data.dailyLimit.toLocaleString()}
Progress: ${progressBar} ${data.percentUsed.toFixed(0)}%

${actionMessage}
  `.trim();
}
