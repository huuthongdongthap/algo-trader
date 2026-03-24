# Master Plan: Algorithm v2.0 — Next Iteration

> BINH_PHAP_TRADING Section 7: Tactical Refinement
> Status: COMPLETE | Deployed: 2026-03-24 18:16 ICT | Commit: a4e201a

## Current State (2026-03-24)

- 37 paper trades, 0 resolved (waiting ~1 week for market resolution)
- 5 strategies active on M1 Max dry-run 24/7
- DNA v2.0 prompt injected, Quarter-Kelly sizing
- Brain-to-Hands wired (DeepSeek R1 -> MM + Executor)

## Gap Analysis

| Feature | BINH_PHAP ref | Status |
|---------|--------------|--------|
| Ensemble N=3 voting | v2.0 | DONE |
| Temperature scaling | Research | DONE |
| Category-specific prompts | v1.2 | DONE |
| Auto-resolution cron | Section 5.3 | DONE |
| Calibration auto-tuner | Section 7.1 | DONE |
| AB test cleanup (remove Qwen) | Qwen removal | DONE |
| News context augmentation | v2.1 | DEFER (need resolution data first) |

## Phases

### Phase 1: Ensemble Voting (variance -15%) [HIGH]
- File: `src/openclaw/ensemble-estimator.ts`
- Run N=3 (not 5, save tokens) independent estimates with temperature variation
- Median aggregation (robust to outliers)
- Confidence = agreement ratio among estimates
- Wire into PredictionLoop as drop-in replacement for single estimate
- Status: DONE

### Phase 2: Temperature Scaling (Brier -0.08) [HIGH]
- File: `src/openclaw/temperature-scaler.ts`
- Platt scaling: calibrated_prob = sigmoid(a * logit(raw_prob) + b)
- Default a=1.0, b=0.0 (identity) until we have resolution data
- Auto-fit from resolved trades when N >= 20
- Wire into PredictionLoop post-estimation
- Status: DONE

### Phase 3: Category-Specific Prompts [MEDIUM]
- File: `src/openclaw/category-prompts.ts`
- Detect category from market question: politics, tech, science, entertainment, sports, other
- Inject category-specific DNA hints into system prompt
- Politics: "Consider polling data, historical election patterns"
- Tech/Science: "Consider technical feasibility, timeline precedents"
- Entertainment: "Consider industry patterns, celebrity behavior base rates"
- Status: DONE

### Phase 4: Auto-Resolution Cron [HIGH]
- File: `scripts/cron-check-resolutions.mjs`
- Run every 6 hours on M1 Max via launchd
- Check Gamma API for resolved markets
- Update paper_trades_v3.resolved + paper_trades_v3.outcome
- Trigger monitor-deepseek-behavior.mjs when resolved count hits milestones (10, 20, 30)
- Status: DONE

### Phase 5: Calibration Auto-Tuner [MEDIUM]
- File: `src/openclaw/calibration-tuner.ts`
- After 20+ resolved trades, compute calibration curve
- Auto-adjust: overconfident -> shrink toward 50%, underconfident -> expand
- Feed adjustments back into temperature scaler (fit a, b params)
- Status: DONE

### Phase 6: AB Test Cleanup [LOW]
- Update `scripts/ab-test-models.mjs`: remove Qwen, add ensemble vs single comparison
- Status: DONE

## Success Criteria

- Ensemble reduces estimate variance by >= 10%
- Temperature scaler ready to auto-fit when resolutions arrive
- Category detection accuracy >= 80%
- Auto-resolution cron running every 6h on M1 Max
- All existing tests still pass (2444/2444)

## Dependencies

- Phase 2 depends on Phase 4 (need resolved trades to fit scaler)
- Phase 5 depends on Phase 4 (need resolved trades)
- Phases 1, 3, 4, 6 are independent -> parallel execution
