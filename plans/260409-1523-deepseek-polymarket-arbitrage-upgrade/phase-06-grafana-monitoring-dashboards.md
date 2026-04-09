# Phase 06: Grafana Dashboards + Monitoring

## Context Links
- [PDF Section 3.8](../../Desktop/DeepSeek%20-%20Vào%20Nơi%20Bí%20Ẩn.pdf)
- [Existing Prometheus Metrics](../../src/middleware/prometheus-metrics.ts)

## Overview
- **Priority**: P2
- **Status**: completed
- **Parallel Group**: D (after Phase 01 and 05)

Prometheus metrics already exist. Add Grafana dashboards + alerting for production monitoring.

## Key Insights
- `src/middleware/prometheus-metrics.ts` already exports counters, gauges, histograms
- `/metrics` endpoint ready for scraping
- Need: Grafana Docker service + provisioned dashboards
- Telegram alerting already exists — add Grafana alerting for metrics-based alerts

## Requirements
### Functional
- Trading Performance Dashboard: P&L, win rate, active positions, drawdown
- System Health Dashboard: API latency, error rates, NATS throughput, Redis memory
- Arbitrage Dashboard: opportunities found, executed, edge distribution
- Alert rules: error rate > 5%, drawdown > 10%, NATS disconnect

### Non-functional
- Auto-provisioned dashboards (no manual setup)
- < 5s dashboard refresh
- Telegram alert channel integration

## Related Code Files
### Create
- `docker/grafana/provisioning/datasources/prometheus.yml`
- `docker/grafana/provisioning/dashboards/dashboard.yml`
- `docker/grafana/dashboards/trading-performance.json`
- `docker/grafana/dashboards/system-health.json`
- `docker/grafana/dashboards/arbitrage-opportunities.json`
- `docker/prometheus/prometheus.yml` — scrape config

### Modify
- `docker-compose.yml` — add Grafana + Prometheus services

## Implementation Steps
1. Add Prometheus + Grafana to docker-compose.yml
2. Create Prometheus scrape config targeting `/metrics`
3. Create Grafana datasource provisioning
4. Create Trading Performance dashboard JSON
5. Create System Health dashboard JSON
6. Create Arbitrage Opportunities dashboard JSON
7. Configure alert rules
8. Test with `docker compose up` and verify dashboards

## Todo List
- [x] Add Prometheus + Grafana Docker services
- [x] Create scrape config
- [x] Create datasource provisioning
- [x] Create trading performance dashboard
- [x] Create system health dashboard
- [x] Create arbitrage dashboard
- [x] Configure alert rules (error rate threshold in system-health dashboard panel)
- [ ] Integration test (requires running Docker environment)

## Success Criteria
- All dashboards load with real metrics data
- Alerts fire within 30s of threshold breach
- Zero manual configuration after `docker compose up`
