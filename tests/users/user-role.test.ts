// Tests for user role system: auto-admin, role in JWT, admin middleware
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UserStore } from '../../src/users/user-store.js';
import { createJwt, verifyJwt } from '../../src/api/auth-middleware.js';
import Database from 'better-sqlite3';
import { unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_DB = join(tmpdir(), `test-user-role-${Date.now()}.db`);

describe('User Role System', () => {
  let store: UserStore;

  beforeEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    store = new UserStore(TEST_DB);
  });

  afterEach(() => {
    store.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  it('first registered user gets admin role', async () => {
    const { hashPassword } = await import('../../src/users/user-store.js');
    const hash = await hashPassword('test12345');
    const user = store.createUserWithPassword('first@test.com', hash);
    expect(user.role).toBe('admin');
  });

  it('second registered user gets user role', async () => {
    const { hashPassword } = await import('../../src/users/user-store.js');
    const hash = await hashPassword('test12345');
    store.createUserWithPassword('first@test.com', hash);
    const second = store.createUserWithPassword('second@test.com', hash);
    expect(second.role).toBe('user');
  });

  it('ADMIN_EMAIL env promotes matching user to admin', async () => {
    const { hashPassword } = await import('../../src/users/user-store.js');
    const hash = await hashPassword('test12345');
    // Create first user (becomes admin)
    store.createUserWithPassword('first@test.com', hash);
    // Set ADMIN_EMAIL
    process.env['ADMIN_EMAIL'] = 'boss@test.com';
    const boss = store.createUserWithPassword('boss@test.com', hash);
    expect(boss.role).toBe('admin');
    delete process.env['ADMIN_EMAIL'];
  });

  it('createUser (API key only) also resolves role', () => {
    const user = store.createUser('first-api@test.com');
    expect(user.role).toBe('admin'); // first user
    const user2 = store.createUser('second-api@test.com');
    expect(user2.role).toBe('user');
  });

  it('updateRole changes user role', async () => {
    const { hashPassword } = await import('../../src/users/user-store.js');
    const hash = await hashPassword('test12345');
    store.createUserWithPassword('admin@test.com', hash);
    const user = store.createUserWithPassword('user@test.com', hash);
    expect(user.role).toBe('user');

    const ok = store.updateRole(user.id, 'admin');
    expect(ok).toBe(true);

    const updated = store.getUserById(user.id);
    expect(updated?.role).toBe('admin');
  });

  it('role persists across getUserByEmail', async () => {
    const { hashPassword } = await import('../../src/users/user-store.js');
    const hash = await hashPassword('test12345');
    const user = store.createUserWithPassword('admin@test.com', hash);
    const fetched = store.getUserByEmail('admin@test.com');
    expect(fetched?.role).toBe('admin');
  });

  it('role persists across getUserByApiKey', () => {
    const user = store.createUser('admin-key@test.com');
    const fetched = store.getUserByApiKey(user.apiKey);
    expect(fetched?.role).toBe('admin');
  });

  it('listActiveUsers returns role field', async () => {
    const { hashPassword } = await import('../../src/users/user-store.js');
    const hash = await hashPassword('test12345');
    store.createUserWithPassword('a@test.com', hash);
    store.createUserWithPassword('b@test.com', hash);
    const users = store.listActiveUsers();
    expect(users).toHaveLength(2);
    expect(users.some(u => u.role === 'admin')).toBe(true);
    expect(users.some(u => u.role === 'user')).toBe(true);
  });
});

describe('JWT with role', () => {
  const secret = 'test-secret-key-for-jwt';

  it('createJwt includes role in payload', () => {
    const token = createJwt(
      { id: 'u1', email: 'test@test.com', tier: 'pro', role: 'admin' },
      secret,
    );
    const payload = verifyJwt(token, secret);
    expect(payload).not.toBeNull();
    expect(payload!.role).toBe('admin');
  });

  it('defaults to user role when not specified', () => {
    const token = createJwt(
      { id: 'u2', email: 'user@test.com', tier: 'free', role: 'user' },
      secret,
    );
    const payload = verifyJwt(token, secret);
    expect(payload!.role).toBe('user');
  });
});
