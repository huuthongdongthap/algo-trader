// Template registry: register, list, and search strategy templates
import type { StrategyName } from '../core/types.js';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface StrategyTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  strategyName: StrategyName;
  /** Default param values merged with user overrides */
  defaultParams: Record<string, unknown>;
  /** Param keys that MUST be supplied (no default) */
  requiredParams: string[];
  riskLevel: RiskLevel;
}

export class TemplateRegistry {
  private templates = new Map<string, StrategyTemplate>();

  /** Add or overwrite a template. Throws if id is empty. */
  register(template: StrategyTemplate): void {
    if (!template.id) throw new Error('Template id must not be empty');
    this.templates.set(template.id, template);
  }

  /** Returns undefined when not found */
  getById(id: string): StrategyTemplate | undefined {
    return this.templates.get(id);
  }

  listAll(): StrategyTemplate[] {
    return Array.from(this.templates.values());
  }

  listByCategory(category: string): StrategyTemplate[] {
    return this.listAll().filter(t => t.category === category);
  }

  /**
   * Case-insensitive substring search over name + description.
   * Returns all templates when query is empty.
   */
  search(query: string): StrategyTemplate[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.listAll();
    return this.listAll().filter(
      t =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q),
    );
  }
}

/** Singleton registry – import this instance everywhere */
export const registry = new TemplateRegistry();
