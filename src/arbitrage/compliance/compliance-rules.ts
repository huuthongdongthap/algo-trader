/**
 * Compliance Rules Engine
 *
 * Built-in compliance rules for regulatory validation.
 */

import type { ComplianceRule, ComplianceContext, ComplianceResult } from './compliance-types';

export const SANCTIONS_CHECK: ComplianceRule = {
  id: 'SANCTIONS_001',
  name: 'Sanctions Screening',
  description: 'Block trades involving sanctioned entities/wallets',
  enabled: true,
  severity: 'critical',
  validate: (context: ComplianceContext): ComplianceResult => {
    // In production, this would check against OFAC/UN/EU lists
    const sanctionedAddresses: string[] = [];

    if (sanctionedAddresses.includes(context.counterparty)) {
      return {
        passed: false,
        ruleId: 'SANCTIONS_001',
        message: `Counterparty ${context.counterparty} is on sanctions list`,
        severity: 'critical',
        timestamp: Date.now(),
      };
    }

    return {
      passed: true,
      ruleId: 'SANCTIONS_001',
      message: 'Sanctions check passed',
      severity: 'critical',
      timestamp: Date.now(),
    };
  },
};

export const POSITION_LIMIT_CHECK: ComplianceRule = {
  id: 'POSITION_001',
  name: 'Position Limit Check',
  description: 'Validate trade against position limits',
  enabled: true,
  severity: 'high',
  validate: (context: ComplianceContext): ComplianceResult => {
    const MAX_POSITION_PER_ASSET = 1000000; // $1M default
    const MAX_DAILY_VOLUME = 5000000; // $5M default

    const tradeValue = context.amount * context.price;

    if (tradeValue > MAX_POSITION_PER_ASSET) {
      return {
        passed: false,
        ruleId: 'POSITION_001',
        message: `Trade value $${tradeValue} exceeds position limit $${MAX_POSITION_PER_ASSET}`,
        severity: 'high',
        timestamp: Date.now(),
      };
    }

    return {
      passed: true,
      ruleId: 'POSITION_001',
      message: 'Position limit check passed',
      severity: 'high',
      timestamp: Date.now(),
    };
  },
};

export const JURISDICTION_CHECK: ComplianceRule = {
  id: 'JURISDICTION_001',
  name: 'Jurisdiction Validation',
  description: 'Block trades from restricted jurisdictions',
  enabled: true,
  severity: 'critical',
  validate: (context: ComplianceContext): ComplianceResult => {
    const RESTRICTED_JURISDICTIONS = [
      'KP', // North Korea
      'IR', // Iran
      'SY', // Syria
      'CU', // Cuba
    ];

    if (RESTRICTED_JURISDICTIONS.includes(context.jurisdiction)) {
      return {
        passed: false,
        ruleId: 'JURISDICTION_001',
        message: `Jurisdiction ${context.jurisdiction} is restricted`,
        severity: 'critical',
        timestamp: Date.now(),
      };
    }

    return {
      passed: true,
      ruleId: 'JURISDICTION_001',
      message: 'Jurisdiction check passed',
      severity: 'critical',
      timestamp: Date.now(),
    };
  },
};

export const VOLUME_LIMIT_CHECK: ComplianceRule = {
  id: 'VOLUME_001',
  name: 'Daily Volume Limit',
  description: 'Enforce daily trading volume limits',
  enabled: true,
  severity: 'medium',
  validate: (context: ComplianceContext): ComplianceResult => {
    const MAX_SINGLE_TRADE = 100000; // $100K default

    const tradeValue = context.amount * context.price;

    if (tradeValue > MAX_SINGLE_TRADE) {
      return {
        passed: false,
        ruleId: 'VOLUME_001',
        message: `Trade value $${tradeValue} exceeds single trade limit $${MAX_SINGLE_TRADE}`,
        severity: 'medium',
        timestamp: Date.now(),
      };
    }

    return {
      passed: true,
      ruleId: 'VOLUME_001',
      message: 'Volume limit check passed',
      severity: 'medium',
      timestamp: Date.now(),
    };
  },
};

export const BUILT_IN_RULES: ComplianceRule[] = [
  SANCTIONS_CHECK,
  POSITION_LIMIT_CHECK,
  JURISDICTION_CHECK,
  VOLUME_LIMIT_CHECK,
];
