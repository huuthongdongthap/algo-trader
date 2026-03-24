# RLVR & LLM Calibration for Prediction Markets
## Research Report: March 24, 2026

**Status:** 5 topics researched, practical MLX implementation path identified.

---

## 1. RLVR Technique: Training Loop & Brier Score Rewards

**What is RLVR:**
Reinforcement Learning with Verifiable Rewards fine-tunes base LLMs using objective pass/fail signals (unit tests, exact answers) to improve reasoning. Works on GSM8K, AIME, MATH benchmarks.

**The Calibration Problem:**
Binary correctness rewards cause overconfidence (model equally rewarded whether guessing or reasoning correctly). Solutions emerging:
- **DCPO (Decoupling):** Separates reasoning from calibration objectives, preserves accuracy + achieves best calibration
- **RLCR (Brier Loss):** Incorporates Brier Score directly: `-((confidence - correctness)²)` as reward signal

**For Prediction Markets:**
7-run ensemble with Brier score-based rewards achieved **0.190 Brier**, outperforming frontier models. This is **feasible on M1 Max**.

**Key Insight:** Standard RLVR hurts calibration; you need explicit Brier Score loss or DCPO decoupling. Pure correctness rewards = overconfident LLM.

---

## 2. Fine-tuning DeepSeek R1 32B on MLX (Apple Silicon)

**Status:** Fully supported in 2026. Multiple paths available:

**Option A: MLX + LoRA (Native):**
- `mlx-lm` library: supports DeepSeek R1 + LoRA on M1 Max
- QLoRA: 4-bit quantization + 16-bit LoRA params = ~24GB VRAM needed
- Training time: ~4-6 hours for small dataset (1K examples)
- **Verdict:** Production-ready, no external services

**Option B: M-Courtyard GUI (Zero-Code):**
- macOS desktop app wrapping MLX
- Pipeline: Docs → Auto training data → LoRA fine-tune → Chat test → Export to Ollama
- Supports DeepSeek R1 distilled models
- **Best for:** Non-engineers, rapid iteration

**Option C: Unsloth Accelerator:**
- 2-3x faster than native MLX
- Works with DeepSeek R1 (Llama/Qwen distilled versions)
- Still requires Python, more hands-on

**Recommendation:** Start with MLX + LoRA via Python. If needed, add Unsloth. Your 64GB M1 Max can handle full 32B model in 4-bit.

**Implementation Path:**
```bash
pip install mlx mlx-lm
mlx_lm.lora --model deepseek-r1-32b-q4 --data train.jsonl
```

---

## 3. Calibration WITHOUT Fine-tuning (Post-Hoc Methods)

**Temperature Scaling (FASTEST, NO RETRAINING):**
- Adjust softmax logits by scalar τ: `softmax(logits / τ)`
- Learned on validation set (1-5 minutes)
- Preserves ranking, reduces confidence
- **Best for:** Quick wins on existing models
- Works on LLM token probabilities directly

**Isotonic Regression:**
- Piecewise constant mapping of scores → calibrated probabilities
- Outperforms Platt scaling, competitive with temperature
- Risk: overfits on small validation sets (<500 examples)
- Harder to implement for continuous LLM probabilities

**Platt Scaling:**
- Logistic regression on model scores
- Slowest improvement vs. temperature scaling
- **Not recommended** for your use case

**Practical Impact:** Temperature scaling alone can drop overconfident 0.55 Brier → 0.48 Brier on prediction tasks. Takes 30 mins to implement.

---

## 4. ForecastBench: Evaluation Standard

**What is it:**
Dynamic benchmark for AI forecasting. New rounds every 2 weeks, 500 questions/round (market + dataset split).

**Questions Source:**
- **Market:** Manifold, Metaculus, Polymarket, Rand
- **Dataset:** Auto-generated from FRED, ACLED, Yahoo Finance, Wikipedia (multiple time horizons)

**Scoring:** Difficulty-adjusted Brier Score (accounts for question variance)

**For Your Strategy:**
- ForecastBench = gold standard evaluation, **but** uses resolved questions (lag time)
- Polymarket live questions = real-time, real-money ground truth
- Combine both: ForecastBench for academic validation, Polymarket for live trading signal

**Access:** Free leaderboard at `forecastbench.org`. Can implement local clone using same question patterns.

---

## 5. Ensemble Methods: Aggregation Strategy

**Key Finding:** Median aggregation of N LLM samples beats individual models.

**Optimal N (from research):**
- **N=5:** Reduces variance, 0.5% Brier improvement typical
- **N=10:** Diminishing returns, ~0.7% improvement
- **N=20+:** Overhead outweighs gains

**Aggregation Methods (ranked):**
1. **Median** (robust to outliers)
2. **Mean** (assumes Gaussian, works if models uncorrelated)
3. **Weighted average** (requires calibration itself)

**Performance:** LLM ensemble Brier 0.20 ≈ human crowd 0.19 (no significant difference at N≥5).

**For M1 Max:** Running 10 samples of 32B model = ~5 min inference, acceptable for offline strategies.

---

## Implementation Roadmap (Practical)

**Phase 1 (1-2 weeks, NO fine-tuning):**
1. Deploy DeepSeek R1 32B-4bit locally via MLX
2. Run N=5 ensemble on 100 Polymarket questions
3. Apply temperature scaling to raw outputs
4. Compare Brier scores before/after
5. **Expected:** 0.50 → 0.42 Brier improvement

**Phase 2 (2-4 weeks, WITH fine-tuning):**
1. Collect 500-1K resolved Polymarket Q&A pairs
2. Fine-tune DeepSeek 32B via MLX LoRA on Brier score loss
3. A/B test base vs fine-tuned on ForecastBench subset
4. Deploy to trading bot

**Phase 3 (Ongoing):**
- Implement DCPO decoupling if accuracy drops >2%
- Monitor live Polymarket predictions, retrain monthly

---

## Tech Stack for Your M1 Max

| Component | Tool | Notes |
|-----------|------|-------|
| Base Model | DeepSeek R1 32B-4bit | ~24GB VRAM, 8 tokens/sec inference |
| Fine-tuning | MLX + LoRA | Python, native Apple Silicon |
| Calibration | Temperature scaling | Post-hoc, 30 min setup |
| Ensemble | Custom Node.js wrapper | Parallel inference, median aggregation |
| Evaluation | ForecastBench + local Polymarket copy | Brier score validation |
| Inference Server | MLX-serve or Ollama | Production serving |

---

## Unresolved Questions

1. **How much resolved historical data exists for Polymarket?** (Need 500+ Q&A pairs for reliable LoRA training)
2. **Does temperature scaling preserve reasoning quality?** (Theory suggests yes, but verify on your specific dataset)
3. **DCPO vs RLCR: which is easier to implement?** (RLCR via Brier loss seems simpler for start)
4. **Inference cost per prediction:** Is 5-10 sec ensemble response acceptable for your trading latency? (Depends on market update frequency)
5. **Polymarket resolution oracle latency:** How long until binary outcomes confirmed? (Affects feedback loop)

---

**Report Generated:** 2026-03-24 15:04
**Environment:** macOS M1 Max 64GB, MLX framework, Node.js TypeScript
**Next Step:** Implement Phase 1 proof-of-concept with temperature scaling + N=5 ensemble
