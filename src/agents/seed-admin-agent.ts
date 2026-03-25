// SeedAdminAgent — registers or promotes a user to admin role
// Usage: algo seed-admin --email <email> --password <pass>
// Idempotent: if user exists, promotes to admin. If not, creates with admin role.

import type { AgentTask, AgentResult, SpecialistAgent, AgentTaskType } from './agent-base.js';
import { successResult, failResult } from './agent-base.js';

export class SeedAdminAgent implements SpecialistAgent {
  readonly name = 'seed-admin';
  readonly description = 'Register or promote a user to admin role';
  readonly taskTypes: AgentTaskType[] = ['seed-admin'];

  canHandle(task: AgentTask): boolean {
    return task.type === 'seed-admin';
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const start = Date.now();
    const email = (task.payload['email'] as string)?.toLowerCase().trim();
    const password = task.payload['password'] as string;

    if (!email || !password) {
      return failResult(this.name, task.id, 'email and password required', Date.now() - start);
    }
    if (password.length < 8) {
      return failResult(this.name, task.id, 'password must be >= 8 chars', Date.now() - start);
    }

    try {
      const { UserStore, hashPassword } = await import('../users/user-store.js');
      const dbPath = process.env['USER_DB_PATH'] ?? 'data/users.db';
      const store = new UserStore(dbPath);

      const existing = store.getUserByEmail(email);
      if (existing) {
        // Promote to admin if not already
        if (existing.role !== 'admin') {
          store.updateRole(existing.id, 'admin');
        }
        store.close();
        return successResult(this.name, task.id, {
          action: 'promoted',
          email,
          role: 'admin',
          userId: existing.id,
        }, Date.now() - start);
      }

      // Create new admin user
      const hash = await hashPassword(password);
      // Temporarily set ADMIN_EMAIL to force admin role
      const prevAdminEmail = process.env['ADMIN_EMAIL'];
      process.env['ADMIN_EMAIL'] = email;
      const user = store.createUserWithPassword(email, hash);
      // Restore
      if (prevAdminEmail) process.env['ADMIN_EMAIL'] = prevAdminEmail;
      else delete process.env['ADMIN_EMAIL'];

      // Double-ensure admin role
      if (user.role !== 'admin') {
        store.updateRole(user.id, 'admin');
      }

      store.close();
      return successResult(this.name, task.id, {
        action: 'created',
        email,
        role: 'admin',
        userId: user.id,
        apiKey: user.apiKey,
      }, Date.now() - start);
    } catch (err) {
      return failResult(this.name, task.id, String(err), Date.now() - start);
    }
  }
}
