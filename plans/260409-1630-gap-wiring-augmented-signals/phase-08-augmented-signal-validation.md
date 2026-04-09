# Phase 08: Augmented Signal Engine — AI Validation Before Execution

## Overview
- **Priority**: P0 (CRITICAL — PDF's "vũ khí bí mật")
- **Status**: pending

The PDF's core differentiator: every arbitrage candidate goes through DeepSeek AI validation BEFORE execution. Currently, semantic discovery runs independently but doesn't gate trades.

## Architecture (from PDF Section 7, Step 4)
```
Signal Engine detects candidate
    ↓
DeepSeek Inference Service validates (semantic check, false positive filter)
    ↓
If confirmed → Risk Manager → Order Manager
If rejected → log + skip
```

## Related Code Files
### Create
- `src/intelligence/signal-validator.ts` — send candidate signal to DeepSeek, get confirm/reject
- `src/wiring/augmented-signal-pipeline.ts` — pipeline: signal → AI validate → risk check → execute

## Implementation Steps
1. Read existing signal flow in `src/polymarket/trading-pipeline.ts`
2. Create `signal-validator.ts`: takes signal candidate + market context → calls DeepSeek API → returns { valid: boolean, confidence: number, reasoning: string }
3. Create `augmented-signal-pipeline.ts`: intercepts signals from strategies, routes through validator, only passes validated signals to execution
4. Use existing LLM config (`src/config/llm-config.ts`) for DeepSeek endpoint
5. Configurable: `AI_VALIDATION_ENABLED=true` env var — can disable for paper trading speed

## Todo List
- [ ] Create signal validator (DeepSeek API call)
- [ ] Create augmented pipeline (signal → validate → execute)
- [ ] Wire into existing execution flow
- [ ] Add AI_VALIDATION_ENABLED config

## Success Criteria
- Signals pass through DeepSeek validation before execution
- False positive rate reduced (measurable in paper trading)
- Configurable — can be disabled for backtesting speed
