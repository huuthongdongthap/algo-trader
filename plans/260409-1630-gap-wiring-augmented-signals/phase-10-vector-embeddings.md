# Phase 10: Vector Embeddings for Semantic Similarity Search

## Overview
- **Priority**: P1
- **Status**: pending

Enhance Phase 02's dependency discovery with vector embeddings for fast similarity search across 500+ markets.

## Related Code Files
### Create
- `src/intelligence/vector-embedding-store.ts` — store/query market description embeddings
- `src/intelligence/semantic-similarity-search.ts` — find similar markets by cosine similarity

## Implementation Steps
1. Use DeepSeek API (or local model) to generate embeddings for market descriptions
2. Store embeddings in Redis as serialized float arrays (key: `embed:{marketId}`)
3. Cosine similarity search: given a market, find top-K most similar
4. Feed similar markets to semantic dependency discovery for deeper analysis
5. Publish similarity graph to NATS

## Success Criteria
- 500 market embeddings generated in < 30s (batched)
- Top-5 similar markets returned in < 10ms (Redis)
- Enhances dependency discovery accuracy
