/**
 * License Keys - Beta Invite System
 * Key generation, validation, and activation flow
 */

import crypto from 'crypto';

export interface LicenseKey {
  id: string;
  key: string;
  tier: 'free' | 'pro' | 'enterprise';
  status: 'pending' | 'active' | 'revoked' | 'expired';
  email?: string;
  createdAt: string;
  activatedAt?: string;
  expiresAt?: string;
  maxUsage?: number;
  usageCount: number;
  metadata?: Record<string, string>;
}

export interface BetaInvite {
  id: string;
  email: string;
  licenseKeyId: string;
  status: 'sent' | 'accepted' | 'expired';
  sentAt: string;
  acceptedAt?: string;
  expiresAt: string;
}

const TIER_PREFIXES: Record<string, string> = {
  free: 'beta',
  pro: 'pro',
  enterprise: 'ent',
};

/**
 * Get activation secret from environment variable
 * CRITICAL: Must be set - no fallback for security
 */
const ACTIVATION_SECRET = process.env.LICENSE_ACTIVATION_SECRET;
if (!ACTIVATION_SECRET) {
  throw new Error('LICENSE_ACTIVATION_SECRET environment variable is required. Generate a secure random string and add it to your .env file.');
}

/**
 * Get encryption key from environment variable
 * Must be 32 characters for AES-256 encryption
 */
const ENCRYPTION_KEY = process.env.LICENSE_ENCRYPTION_KEY;

/**
 * Validate encryption key is present and correct length
 */
function getEncryptionKey(): Buffer {
  if (!ENCRYPTION_KEY) {
    throw new Error(
      'LICENSE_ENCRYPTION_KEY is not set. Generate a 32-character key and add it to your .env file.'
    );
  }
  if (ENCRYPTION_KEY.length !== 32) {
    throw new Error(
      `LICENSE_ENCRYPTION_KEY must be exactly 32 characters (current: ${ENCRYPTION_KEY.length}). ` +
        'Generate one with: openssl rand -hex 16'
    );
  }
  return Buffer.from(ENCRYPTION_KEY, 'utf-8');
}

/**
 * Generate a unique license key
 */
export function generateLicenseKey(tier: 'free' | 'pro' | 'enterprise' = 'free'): string {
  const prefix = TIER_PREFIXES[tier];
  const timestamp = Date.now().toString(36).toUpperCase();

  // Generate random segments
  const segment1 = crypto.randomBytes(4).toString('hex').toUpperCase();
  const segment2 = crypto.randomBytes(4).toString('hex').toUpperCase();

  // Create checksum for validation
  const checksum = crypto
    .createHash('sha256')
    .update(`${prefix}-${timestamp}-${segment1}-${segment2}-${ACTIVATION_SECRET}`)
    .digest('hex')
    .substring(0, 4)
    .toUpperCase();

  return `ALGO-${prefix}-${timestamp}-${segment1}-${segment2}-${checksum}`;
}

/**
 * Validate license key format and checksum
 */
export function validateLicenseKeyFormat(key: string): { valid: boolean; error?: string } {
  if (!key) {
    return { valid: false, error: 'License key is required' };
  }

  // Format: ALGO-{tier}-{timestamp}-{segment1}-{segment2}-{checksum}
  const parts = key.split('-');

  if (parts.length !== 6) {
    return { valid: false, error: 'Invalid license key format' };
  }

  if (parts[0] !== 'ALGO') {
    return { valid: false, error: 'Invalid license key prefix' };
  }

  const tier = parts[1].toLowerCase();
  if (!['beta', 'pro', 'ent'].includes(tier)) {
    return { valid: false, error: 'Invalid license tier' };
  }

  // Verify checksum
  const [prefix, tierPart, timestamp, segment1, segment2, checksum] = parts;
  const expectedChecksum = crypto
    .createHash('sha256')
    .update(`${prefix}-${tierPart}-${timestamp}-${segment1}-${segment2}-${ACTIVATION_SECRET}`)
    .digest('hex')
    .substring(0, 4)
    .toUpperCase();

  if (checksum !== expectedChecksum) {
    return { valid: false, error: 'Invalid license key checksum' };
  }

  return { valid: true };
}

/**
 * Extract tier from license key
 */
export function extractTierFromKey(key: string): 'free' | 'pro' | 'enterprise' | null {
  const parts = key.split('-');
  if (parts.length !== 6) return null;

  const tierPart = parts[1].toLowerCase();
  switch (tierPart) {
    case 'beta':
      return 'free';
    case 'pro':
      return 'pro';
    case 'ent':
      return 'enterprise';
    default:
      return null;
  }
}

/**
 * Encrypt license key for secure storage using AES-256-CBC
 */
export function encryptLicenseKey(key: string): string {
  const encryptionKey = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', encryptionKey, iv);

  let encrypted = cipher.update(key, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  // Return IV + encrypted data (IV needed for decryption)
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt license key from storage
 */
export function decryptLicenseKey(encrypted: string): string {
  const encryptionKey = getEncryptionKey();
  const parts = encrypted.split(':');

  if (parts.length !== 2) {
    throw new Error('Invalid encrypted license key format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const encryptedData = parts[1];

  const decipher = crypto.createDecipheriv('aes-256-cbc', encryptionKey, iv);
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Create a new license key for beta invite
 */
export function createLicenseKey(
  email: string,
  tier: 'free' | 'pro' | 'enterprise' = 'free',
  options?: {
    maxUsage?: number;
    expiresAt?: string;
    metadata?: Record<string, string>;
  }
): LicenseKey {
  const id = `lic_${crypto.randomBytes(8).toString('hex')}`;
  const key = generateLicenseKey(tier);
  const now = new Date().toISOString();

  return {
    id,
    key,
    tier,
    status: 'pending',
    email,
    createdAt: now,
    usageCount: 0,
    maxUsage: options?.maxUsage || getDefaultMaxUsage(tier),
    expiresAt: options?.expiresAt,
    metadata: options?.metadata,
  };
}

/**
 * Create beta invite
 */
export function createBetaInvite(email: string, licenseKeyId: string): BetaInvite {
  const id = `invite_${crypto.randomBytes(8).toString('hex')}`;
  const now = new Date();

  // Beta invites expire in 7 days
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

  return {
    id,
    email,
    licenseKeyId,
    status: 'sent',
    sentAt: now.toISOString(),
    expiresAt,
  };
}

/**
 * Activate license key
 */
export function activateLicenseKey(license: LicenseKey): LicenseKey {
  if (license.status !== 'pending') {
    throw new Error(`License is not pending (current status: ${license.status})`);
  }

  license.status = 'active';
  license.activatedAt = new Date().toISOString();

  return license;
}

/**
 * Check if license is expired
 */
export function isLicenseExpired(license: LicenseKey): boolean {
  if (!license.expiresAt) return false;
  return new Date(license.expiresAt) < new Date();
}

/**
 * Get default max usage based on tier
 */
export function getDefaultMaxUsage(tier: 'free' | 'pro' | 'enterprise'): number {
  switch (tier) {
    case 'free':
      return 100; // 100 API calls for beta
    case 'pro':
      return 10000;
    case 'enterprise':
      return 100000;
  }
}

/**
 * Generate invitation email content
 */
export function generateInviteEmail(
  email: string,
  licenseKey: string,
  inviteUrl: string
): { subject: string; html: string; text: string } {
  const subject = '🚀 You\'re invited to Algo Trader Beta!';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center; }
    .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; }
    .license-key { background: white; padding: 15px; border-radius: 5px; font-family: monospace; font-size: 16px; text-align: center; border: 2px dashed #667eea; margin: 20px 0; word-break: break-all; }
    .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin-top: 20px; }
    .footer { text-align: center; color: #666; margin-top: 30px; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎉 Welcome to Algo Trader Beta!</h1>
    </div>
    <div class="content">
      <p>Hi there,</p>
      <p>You've been selected to join the Algo Trader beta program! Your exclusive license key is ready:</p>

      <div class="license-key">${licenseKey}</div>

      <p>Click below to activate your license and start trading:</p>

      <p style="text-align: center;">
        <a href="${inviteUrl}" class="button">Activate License</a>
      </p>

      <h3>Next Steps:</h3>
      <ol>
        <li>Copy your license key above</li>
        <li>Run <code>npm install -g @mekong/algo-trader</code></li>
        <li>Run <code>algo-trader activate</code> and paste your key</li>
        <li>Start trading with <code>algo-trader quickstart</code></li>
      </ol>

      <p class="footer">
        This invite expires in 7 days. Questions? Reply to this email.<br>
        © 2026 Algo Trader - AgencyOS
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
🎉 Welcome to Algo Trader Beta!

Your exclusive license key:
${licenseKey}

Activate your license here:
${inviteUrl}

Next Steps:
1. Copy your license key above
2. Run: npm install -g @mekong/algo-trader
3. Run: algo-trader activate <your-key>
4. Start trading: algo-trader quickstart

This invite expires in 7 days.

Questions? Reply to this email.
© 2026 Algo Trader - AgencyOS
  `.trim();

  return { subject, html, text };
}

/**
 * In-memory store for demo (replace with database in production)
 */
class LicenseStore {
  private static instance: LicenseStore;
  private licenses: Map<string, LicenseKey> = new Map();
  private invites: Map<string, BetaInvite> = new Map();
  private byKey: Map<string, string> = new Map(); // key -> licenseId
  private byEmail: Map<string, string> = new Map(); // email -> licenseId

  private constructor() {}

  static getInstance(): LicenseStore {
    if (!LicenseStore.instance) {
      LicenseStore.instance = new LicenseStore();
    }
    return LicenseStore.instance;
  }

  saveLicense(license: LicenseKey): void {
    this.licenses.set(license.id, license);
    this.byKey.set(license.key, license.id);
    if (license.email) {
      this.byEmail.set(license.email, license.id);
    }
  }

  saveInvite(invite: BetaInvite): void {
    this.invites.set(invite.id, invite);
  }

  getLicense(id: string): LicenseKey | undefined {
    return this.licenses.get(id);
  }

  getLicenseByKey(key: string): LicenseKey | undefined {
    const licenseId = this.byKey.get(key);
    if (!licenseId) return undefined;
    return this.licenses.get(licenseId);
  }

  getLicenseByEmail(email: string): LicenseKey | undefined {
    const licenseId = this.byEmail.get(email);
    if (!licenseId) return undefined;
    return this.licenses.get(licenseId);
  }

  getInvite(id: string): BetaInvite | undefined {
    return this.invites.get(id);
  }

  listLicenses(): LicenseKey[] {
    return Array.from(this.licenses.values());
  }

  listInvites(): BetaInvite[] {
    return Array.from(this.invites.values());
  }
}

export { LicenseStore };
