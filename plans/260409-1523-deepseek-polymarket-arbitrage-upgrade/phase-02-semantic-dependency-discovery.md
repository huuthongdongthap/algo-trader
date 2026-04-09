# Phase 02: Semantic Dependency Discovery

## Context Links
- [PDF Section 5: DeepSeek Integration](../../Desktop/DeepSeek%20-%20Vào%20Nơi%20Bí%20Ẩn.pdf)
- [Existing Intelligence Server](../../intelligence/server.py)
- [Existing DeepSeek Config](../../src/config/)

## Overview
- **Priority**: P1
- **Status**: completed
- **Parallel Group**: B (after Phase 01)

Use DeepSeek API to discover semantic/logical dependencies between Polymarket markets. Example: "Trump wins Pennsylvania" and "Republicans win >5% in PA" are logically correlated — traditional bots miss this.

## Key Insights
- DeepSeek API is OpenAI-compatible (already integrated via OpenClaw gateway)
- Need: market descriptions → DeepSeek → relationship graph → Signal Engine
- Cache relationships in Redis (TTL 1h) to avoid repeated API calls
- Vector embeddings for semantic similarity search (optional, Phase 2 enhancement)

## Requirements
### Functional
- Fetch all active Polymarket market descriptions via Gamma API
- Send batched market descriptions to DeepSeek for relationship analysis
- Build dependency graph: Market A → Market B (causal, mutual exclusion, conditional)
- Confidence scores for each relationship
- Publish graph updates to NATS topic `intelligence.dependencies.updated`

### Non-functional
- Process 500+ markets in < 60s (batched)
- Cache results, refresh every 1h
- Graceful handling of DeepSeek API rate limits

## Architecture
```
[Gamma API] → market descriptions
      ↓
[Context Builder] → batch descriptions into prompts
      ↓
[DeepSeek API] → semantic inference (relationships)
      ↓
[Relationship Graph Builder] → typed graph structure
      ↓
[Redis Cache] + [NATS publish] → downstream consumers
```

## Related Code Files
### Modify
- `src/intelligence/index.ts` — add semantic discovery module export
- `src/config/index.ts` — add DEEPSEEK_API_KEY, SEMANTIC_REFRESH_INTERVAL

### Create
- `src/intelligence/semantic-dependency-discovery.ts` — main orchestrator
- `src/intelligence/market-context-builder.ts` — batch market descriptions into prompts
- `src/intelligence/relationship-graph-builder.ts` — parse DeepSeek response → typed graph
- `src/intelligence/semantic-cache.ts` — Redis cache for relationships
- `src/types/semantic-relationships.ts` — types for graph, relationships, confidence

## Implementation Steps
1. Create `src/types/semantic-relationships.ts` — MarketRelationship, DependencyGraph types
2. Create `src/intelligence/market-context-builder.ts` — fetch from Gamma API, batch into prompts
3. Create `src/intelligence/semantic-dependency-discovery.ts` — call DeepSeek API with structured prompt
4. Create `src/intelligence/relationship-graph-builder.ts` — parse JSON response into typed graph
5. Create `src/intelligence/semantic-cache.ts` — Redis get/set with TTL
6. Wire into existing intelligence module
7. Publish results to NATS `intelligence.dependencies.updated`
8. Write tests with mocked DeepSeek responses

## Todo List
- [x] Define relationship types and graph interfaces
- [x] Implement market context builder (Gamma API fetch)
- [x] Implement DeepSeek prompt for relationship discovery
- [x] Implement response parser → dependency graph
- [x] Implement Redis caching layer
- [x] Wire into intelligence module
- [x] Publish to NATS
- [ ] Write unit tests
- [ ] Integration test with real Gamma API data

## Success Criteria
- Discovers 50+ market relationships from 500 active markets
- Confidence scores > 0.7 for valid relationships
- Cached results reduce API calls by 90%
- Graph consumable by Signal Engine (Phase 03)

## Risk Assessment
- **DeepSeek hallucinations**: Validate relationships with price correlation check
- **API costs**: Batch processing + caching minimize calls
- **Rate limits**: Exponential backoff + queue

## Security Considerations
- DeepSeek API key in env vars only
- No market-sensitive data logged
