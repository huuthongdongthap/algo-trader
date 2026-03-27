# Beta Launch Checklist — Algo Trader v5.6

**Version:** 5.6.0-beta
**Launch Date:** [TBD]
**Launch Type:** Private Beta (invite-only)
**Success Criteria:** 95% uptime, <2s page load, 0 critical bugs

---

## 1. Pre-Flight Checks (T-7 Days)

### 1.1 Security Audit
- [ ] **API Keys**: No secrets in codebase (`.env` only, gitignored)
- [ ] **Authentication**: JWT validation working, token expiry enforced
- [ ] **Rate Limiting**: Sliding window rate limiter active (100 req/min per API key)
- [ ] **CORS**: Only allowed origins configured
- [ ] **HTTPS**: Enforced in production (HSTS header present)
- [ ] **Security Headers**: CSP, X-Frame-Options, X-Content-Type-Options set
- [ ] **Input Validation**: All API endpoints use Zod schemas
- [ ] **SQL Injection**: All queries use parameterized statements (Prisma ORM)

**Verification:**
```bash
# Security scan
npm audit --audit-level=high
grep -r "API_KEY\|SECRET" dashboard/src --include="*.ts" | wc -l  # Must be 0
```

### 1.2 Performance Baseline
- [ ] **Bundle Size**: Dashboard < 500KB gzipped
- [ ] **Page Load**: Lighthouse desktop < 2s, mobile < 3s
- [ ] **LCP**: Largest Contentful Paint < 2.5s
- [ ] **TTI**: Time to Interactive < 4s
- [ ] **API Latency**: p95 < 500ms for all endpoints

**Verification:**
```bash
# Build and check bundle
cd dashboard && npm run build
# Lighthouse CI
npx lhci autorun
```

### 1.3 Infrastructure Readiness
- [ ] **Database**: PostgreSQL running, migrations applied
- [ ] **Redis**: Connection pool configured, BullMQ queues active
- [ ] **WebSocket**: WS server running, auto-reconnect working
- [ ] **Monitoring**: Prometheus metrics exposed at `/metrics`
- [ ] **Logging**: Winston logs structured (JSON), log rotation configured
- [ ] **Backups**: Daily automated backups configured, tested restore

**Verification:**
```bash
# Check database
npx prisma migrate status
# Check Redis
redis-cli ping
# Check WebSocket
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" http://localhost:3001/ws
```

### 1.4 Error Handling
- [ ] **Error Boundaries**: React error boundaries wrap all pages
- [ ] **Fallback UI**: Graceful degradation on errors (no blank screens)
- [ ] **Error Logging**: All errors logged with context (user, action, timestamp)
- [ ] **Alerting**: Error rate > 1% triggers alert (Slack/PagerDuty)

**Verification:**
```bash
# Force error and check logging
curl -X POST http://localhost:3000/api/v1/test/error
# Check logs for structured output
tail -f logs/app.log | jq 'select(.level == "error")'
```

---

## 2. Launch Checklist (T-0 Day)

### 2.1 Code Freeze & Final Checks
- [ ] **Git Tag**: `git tag -a v5.6.0-beta -m "Beta Launch"`
- [ ] **Main Branch**: All tests passing, 0 TypeScript errors
- [ ] **Changelog**: `docs/project-changelog.md` updated
- [ ] **Roadmap**: `docs/project-roadmap.md` Phase 5.6 marked complete

**Verification:**
```bash
npm run build && npm test  # Must pass 100%
npx tsc --noEmit           # Must be 0 errors
```

### 2.2 Deployment
- [ ] **Staging**: Deployed to staging, smoke test passed
- [ ] **Production**: Git push to main, GitHub Actions GREEN
- [ ] **Database Migrations**: Applied successfully
- [ ] **Environment Variables**: All production env vars set
- [ ] **SSL Certificates**: Valid, auto-renewal configured

**Verification:**
```bash
# Production health check
curl -sI https://algo-trader.example.com | head -3  # HTTP 200
curl -s https://algo-trader.example.com/api/health  # {"status":"ok"}
```

### 2.3 Monitoring & Alerting
- [ ] **Uptime Monitor**: UptimeRobot/Pingdom configured (5-min intervals)
- [ ] **Error Tracking**: Sentry configured, source maps uploaded
- [ ] **Performance**: Grafana dashboards live, key metrics visible
- [ ] **On-Call**: Slack channel `#algo-trader-beta` created, team added

**Verification:**
```bash
# Check Sentry
curl -s https://sentry.io/api/0/projects/[org]/[project]/stats/
# Check Grafana
curl -s http://grafana:3000/api/health
```

### 2.4 Documentation
- [ ] **README**: Updated with beta notice, setup instructions
- [ ] **API Docs**: `/docs` page live, all endpoints documented
- [ ] **User Guide**: `docs/guide/` updated with beta features
- [ ] **Known Issues**: `docs/beta-known-issues.md` created
- [ ] **Support**: Support email/Slack documented

---

## 3. Rollback Plan (Emergency)

### 3.1 Rollback Triggers
Rollback IMMEDIATELY if any of these occur:
- [ ] Error rate > 5% for 10+ minutes
- [ ] API latency p95 > 5s for 15+ minutes
- [ ] Database connection failures
- [ ] Security breach detected
- [ ] Data corruption detected

### 3.2 Rollback Steps
```bash
# Step 1: Stop new deployments
# In GitHub: DisableActions for repo

# Step 2: Revert to previous version
git revert HEAD --no-edit
git push origin main

# Step 3: Rollback database (if migration caused issue)
npx prisma migrate resolve --rolled-back [migration_name]

# Step 4: Notify team
# Post in #algo-trader-beta: "ROLLBACK INITIATED - [time]"

# Step 5: Verify rollback
curl -sI https://algo-trader.example.com  # Should return previous version
```

### 3.3 Rollback Verification
- [ ] Previous version deployed and responding
- [ ] Error rate returned to baseline (<1%)
- [ ] API latency p95 < 500ms
- [ ] No data loss detected

---

## 4. Support Runbook (During Beta)

### 4.1 Support Channels
| Channel | Response Time | Escalation |
|---------|---------------|------------|
| Email: beta@algo-trader.com | 24 hours | Day 2 → Slack |
| Slack: #algo-trader-beta | 4 hours | Day 1 → Phone |
| GitHub Issues | 48 hours | Week 1 → Email |

### 4.2 Common Issues & Fixes

#### Issue: User can't login
**Symptoms:** 401 errors, "Invalid credentials"
**Fix:**
1. Check user in database: `SELECT * FROM "User" WHERE email = '[email]'`
2. Verify password hash format
3. Reset password if needed: `npx ts-node scripts/reset-password.ts [email]`

#### Issue: Dashboard shows "Disconnected"
**Symptoms:** WebSocket not connecting
**Fix:**
1. Check WS server status: `systemctl status algo-trader-ws`
2. Verify WS_URL env var matches production
3. Check firewall rules for WS port

#### Issue: Slow page load
**Symptoms:** LCP > 4s, users complaining
**Fix:**
1. Check CDN cache hit rate
2. Verify bundle size hasn't increased
3. Check API response times in Grafana

#### Issue: API rate limit errors
**Symptoms:** 429 Too Many Requests
**Fix:**
1. Check user's API key usage: `SELECT * FROM "ApiUsage" WHERE apiKey = '[key]'`
2. Increase limit if legitimate: Update rate limiter config
3. Block if abuse detected

### 4.3 Escalation Path
```
Level 1: Support Engineer (first 24h)
  ↓
Level 2: Engineering Lead (24-48h)
  ↓
Level 3: CTO/OpenClaw (48h+, critical issues)
```

### 4.4 Communication Templates

**Bug Acknowledgment:**
> "Hi [user], thanks for reporting this. We've identified the issue and are working on a fix. Expected resolution: [time]. We'll update you when fixed."

**Bug Fixed:**
> "Hi [user], the issue you reported has been fixed in v5.6.1. Please refresh your browser or clear cache. Let us know if you see any issues."

**Scheduled Maintenance:**
> "Scheduled maintenance: [date] [time] [timezone]. Expected downtime: 30 minutes. Trading will continue uninterrupted."

---

## 5. Success Metrics (Track Daily)

### 5.1 Technical Metrics
| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Uptime | 99.5% | < 95% |
| Page Load (p95) | < 2s | > 4s |
| API Latency (p95) | < 500ms | > 2s |
| Error Rate | < 1% | > 5% |
| WebSocket Latency | < 1s | > 3s |

### 5.2 User Metrics
| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| DAU (Daily Active Users) | Track | > 20% drop |
| Session Duration | > 5 min | < 2 min |
| Feature Adoption | Track | N/A |
| Support Tickets | < 10/day | > 20/day |

### 5.3 Beta Feedback Goals
- [ ] 10+ beta users onboarded
- [ ] 5+ detailed feedback responses
- [ ] 3+ bug reports (expected for beta)
- [ ] 1+ feature requests implemented

---

## 6. Beta Timeline

| Date | Milestone | Owner |
|------|-----------|-------|
| T-7d | Pre-flight checks complete | Engineering |
| T-3d | Staging deployment verified | DevOps |
| T-1d | Code freeze, final smoke test | Engineering |
| T-0 | **BETA LAUNCH** | All Hands |
| T+1d | Daily standup, issue triage | Engineering |
| T+7d | Week 1 review, decision: extend/graduate | Leadership |
| T+30d | Beta ends → GA or extend | Leadership |

---

## 7. Sign-Off

| Role | Name | Sign-Off Date |
|------|------|---------------|
| Engineering Lead | [Name] | [Date] |
| Product Manager | [Name] | [Date] |
| DevOps Lead | [Name] | [Date] |
| Security Lead | [Name] | [Date] |
| CTO (OpenClaw) | [Auto] | [Date] |

---

**Last Updated:** 2026-03-20
**Next Review:** T-7 days before launch
