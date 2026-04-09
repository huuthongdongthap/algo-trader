# Phase 09: News Impact Analysis Feed

## Overview
- **Priority**: P1
- **Status**: pending

Ingest external news, analyze impact on Polymarket probabilities. PDF Section 3.3 task 3.

## Related Code Files
### Create
- `src/feeds/news-impact-analyzer.ts` — fetch news, call DeepSeek to assess market impact
- `src/feeds/news-market-correlator.ts` — map news events to specific Polymarket markets

## Implementation Steps
1. Read existing `src/data/sentiment-feed.ts` for current sentiment patterns
2. Create `news-impact-analyzer.ts`: RSS/API news fetch → DeepSeek prompt "How does this event affect these markets?" → impact scores per market
3. Create `news-market-correlator.ts`: match news keywords to active Polymarket market descriptions
4. Publish results to NATS `intelligence.news.impact`
5. Signal engine consumes impact scores as additional input

## Success Criteria
- News events mapped to relevant markets within 60s
- Impact score reflects probability shift direction
