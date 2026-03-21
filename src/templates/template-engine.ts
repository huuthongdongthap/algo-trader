// Template engine: instantiate templates with user params and convert to StrategyConfig
import type { StrategyConfig } from '../core/types.js';
import type { StrategyTemplate } from './template-registry.js';

// --- Error ---

export class ParamValidationError extends Error {
  constructor(
    public readonly templateId: string,
    public readonly issues: string[],
  ) {
    super(`Template "${templateId}" validation failed: ${issues.join('; ')}`);
    this.name = 'ParamValidationError';
  }
}

// --- Result types ---

export interface TemplateInstance {
  templateId: string;
  /** Final merged params (defaults overridden by user) */
  params: Record<string, unknown>;
  strategyConfig: StrategyConfig;
}

// --- Engine ---

export class TemplateEngine {
  /**
   * Merge defaultParams + userParams, validate, then produce a TemplateInstance.
   * Throws ParamValidationError on missing required params.
   */
  instantiate(
    template: StrategyTemplate,
    userParams: Record<string, unknown> = {},
  ): TemplateInstance {
    const params = { ...template.defaultParams, ...userParams };
    this.validateParams(template, params);
    return {
      templateId: template.id,
      params,
      strategyConfig: this.toStrategyConfig(template, params),
    };
  }

  /**
   * Validate that all requiredParams are present and non-null/undefined.
   * Also performs basic type consistency check against defaultParams.
   */
  validateParams(
    template: StrategyTemplate,
    params: Record<string, unknown>,
  ): void {
    const issues: string[] = [];

    for (const key of template.requiredParams) {
      if (params[key] === undefined || params[key] === null) {
        issues.push(`Missing required param "${key}"`);
      }
    }

    // Type consistency: if default exists, user override must share the same typeof
    for (const [key, defaultVal] of Object.entries(template.defaultParams)) {
      const userVal = params[key];
      if (userVal === undefined) continue; // will be filled from default
      const expectedType = typeof defaultVal;
      const actualType = typeof userVal;
      if (expectedType !== 'undefined' && actualType !== expectedType) {
        issues.push(
          `Param "${key}" expects type ${expectedType}, got ${actualType}`,
        );
      }
    }

    if (issues.length > 0) {
      throw new ParamValidationError(template.id, issues);
    }
  }

  /**
   * Convert a template + merged params into a StrategyConfig consumable by the engine.
   * capitalAllocation defaults to '0' – caller should override for live trading.
   */
  toStrategyConfig(
    template: StrategyTemplate,
    params: Record<string, unknown>,
  ): StrategyConfig {
    return {
      name: template.strategyName,
      enabled: true,
      capitalAllocation: String(params['capitalAllocation'] ?? '0'),
      params,
    };
  }
}

/** Singleton engine instance */
export const engine = new TemplateEngine();
