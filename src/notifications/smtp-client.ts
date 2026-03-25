// Lightweight SMTP client using Node.js built-in net/tls — no external deps
// Supports STARTTLS, AUTH LOGIN/PLAIN, and direct TLS connections
import { createConnection, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { logger } from '../core/logger.js';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean; // true = direct TLS (465), false = STARTTLS (587)
  username: string;
  password: string;
}

/** Send raw SMTP command and wait for response */
function sendCommand(
  socket: Socket | TLSSocket,
  command: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('SMTP timeout')), 15_000);
    socket.once('data', (data: Buffer) => {
      clearTimeout(timeout);
      resolve(data.toString());
    });
    socket.once('error', (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });
    socket.write(command + '\r\n');
  });
}

/** Wait for initial server greeting */
function waitGreeting(socket: Socket | TLSSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('SMTP greeting timeout')), 10_000);
    socket.once('data', (data: Buffer) => {
      clearTimeout(timeout);
      resolve(data.toString());
    });
    socket.once('error', (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/** Upgrade plain socket to TLS via STARTTLS */
function upgradeToTls(socket: Socket, host: string): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const tls = tlsConnect({ socket, host, rejectUnauthorized: true }, () => {
      resolve(tls);
    });
    tls.once('error', reject);
  });
}

/** Check SMTP response code is in expected range */
function assertCode(response: string, expected: number, context: string): void {
  const code = parseInt(response.substring(0, 3), 10);
  if (code !== expected) {
    throw new Error(`SMTP ${context}: expected ${expected}, got "${response.trim()}"`);
  }
}

/**
 * Send an email via SMTP. Supports:
 *  - Direct TLS (port 465)
 *  - STARTTLS (port 587)
 *  - AUTH LOGIN
 */
export async function sendSmtpEmail(
  config: SmtpConfig,
  from: string,
  to: string,
  subject: string,
  htmlBody: string,
): Promise<void> {
  let socket: Socket | TLSSocket;

  if (config.secure) {
    // Direct TLS connection (port 465)
    socket = tlsConnect({
      host: config.host,
      port: config.port,
      rejectUnauthorized: true,
    });
    await new Promise<void>((resolve, reject) => {
      (socket as TLSSocket).once('secureConnect', resolve);
      socket.once('error', reject);
    });
  } else {
    // Plain connection → STARTTLS upgrade (port 587)
    socket = createConnection({ host: config.host, port: config.port });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
  }

  try {
    // Greeting
    const greeting = await waitGreeting(socket);
    assertCode(greeting, 220, 'greeting');

    // EHLO
    let resp = await sendCommand(socket, `EHLO ${config.host}`);
    assertCode(resp, 250, 'EHLO');

    // STARTTLS for non-secure connections
    if (!config.secure) {
      resp = await sendCommand(socket, 'STARTTLS');
      assertCode(resp, 220, 'STARTTLS');
      socket = await upgradeToTls(socket as Socket, config.host);
      // Re-EHLO after TLS upgrade
      resp = await sendCommand(socket, `EHLO ${config.host}`);
      assertCode(resp, 250, 'EHLO-post-TLS');
    }

    // AUTH LOGIN
    resp = await sendCommand(socket, 'AUTH LOGIN');
    assertCode(resp, 334, 'AUTH LOGIN');
    resp = await sendCommand(socket, Buffer.from(config.username).toString('base64'));
    assertCode(resp, 334, 'AUTH username');
    resp = await sendCommand(socket, Buffer.from(config.password).toString('base64'));
    assertCode(resp, 235, 'AUTH password');

    // MAIL FROM / RCPT TO / DATA
    resp = await sendCommand(socket, `MAIL FROM:<${from}>`);
    assertCode(resp, 250, 'MAIL FROM');
    resp = await sendCommand(socket, `RCPT TO:<${to}>`);
    assertCode(resp, 250, 'RCPT TO');
    resp = await sendCommand(socket, 'DATA');
    assertCode(resp, 354, 'DATA');

    // Build message with headers
    const message = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=utf-8`,
      `Date: ${new Date().toUTCString()}`,
      '',
      htmlBody,
    ].join('\r\n');

    resp = await sendCommand(socket, message + '\r\n.');
    assertCode(resp, 250, 'message accepted');

    // QUIT
    await sendCommand(socket, 'QUIT').catch(() => {});
    logger.info('Email sent via SMTP', 'SmtpClient', { to, subject });
  } finally {
    socket.destroy();
  }
}
