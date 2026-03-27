# Algo Trader Postmortem Template

## Incident Classification

| Severity | Description | Response Time | Notification |
|----------|-------------|---------------|--------------|
| **SEV1** | Complete system outage, critical trading functionality down, data loss | Immediate (0-15 min) | All stakeholders, emergency channels |
| **SEV2** | Partial system degradation, non-critical features down, performance issues | Within 1 hour | Core team, affected users |
| **SEV3** | Minor issues, cosmetic problems, non-essential features affected | Within 4 hours | Development team |
| **SEV4** | Low impact issues, documentation errors, minor UX problems | Within 24 hours | Relevant team members |

**Incident Severity**: [SEV1/SEV2/SEV3/SEV4]

## Basic Information

- **Incident ID**: `[AUTO-GENERATED: YYYYMMDD-SEV#-NNN]`
- **Date/Time Started**: `[UTC timestamp]`
- **Date/Time Resolved**: `[UTC timestamp]`
- **Duration**: `[Total downtime/duration]`
- **Affected Systems**: `[List of affected components/services]`
- **Primary Owner**: `[Name/Team responsible for resolution]`
- **Secondary Owners**: `[Additional team members involved]`

## Timeline Format

Use UTC timestamps in `YYYY-MM-DD HH:MM:SS UTC` format.

| Time (UTC) | Event | Action Taken | Owner |
|------------|-------|--------------|-------|
| 2026-03-15 10:00:00 UTC | Initial alert triggered | PagerDuty alert sent | Monitoring System |
| 2026-03-15 10:02:30 UTC | Engineer acknowledged | Started investigation | John Doe |
| 2026-03-15 10:15:45 UTC | Root cause identified | Identified database connection pool exhaustion | Jane Smith |
| 2026-03-15 10:25:12 UTC | Mitigation applied | Increased connection pool size, restarted service | John Doe |
| 2026-03-15 10:30:00 UTC | Service restored | Verified all endpoints responding normally | Jane Smith |
| 2026-03-15 11:00:00 UTC | Incident closed | Confirmed stability for 30 minutes | Team Lead |

## Root Cause Analysis Template

### Problem Statement
Clear, concise description of what went wrong.

> Example: "The trading bot stopped executing orders due to database connection pool exhaustion, causing a 30-minute service interruption."

### Contributing Factors
List all factors that contributed to the incident.

- **Primary Cause**: [Main technical root cause]
- **Secondary Causes**: [Additional contributing factors]
- **Process Gaps**: [Missing procedures, lack of monitoring, etc.]
- **Human Factors**: [Misconfigurations, deployment errors, etc.]

### Technical Details
Provide technical specifics about the root cause.

#### Error Logs
```
[Relevant error messages and stack traces]
```

#### Metrics During Incident
- CPU Usage: [Before/During/After]
- Memory Usage: [Before/During/After]
- Database Connections: [Before/During/After]
- API Response Times: [Before/During/After]
- Error Rates: [Before/During/After]

#### System Architecture Impact
Describe how the incident affected the system architecture.

> Example: "The connection pool exhaustion caused a cascading failure where the OrderManager could not communicate with the database, leading to failed trade executions and unprocessed signals."

## Action Items Tracker

| Action Item | Owner | Due Date | Status | Priority |
|-------------|-------|----------|--------|----------|
| Increase database connection pool size | DevOps Team | 2026-03-22 | TODO | High |
| Implement connection pool monitoring alerts | SRE Team | 2026-03-29 | TODO | High |
| Add circuit breaker for database connections | Backend Team | 2026-04-05 | TODO | Medium |
| Update runbook for connection pool issues | Documentation Team | 2026-03-22 | TODO | Medium |
| Conduct load testing for connection pools | QA Team | 2026-04-12 | TODO | Medium |

### Action Item Categories
- **Immediate Fixes**: Actions to prevent immediate recurrence
- **Short-term Improvements**: Actions to be completed within 2 weeks
- **Long-term Solutions**: Architectural or process changes for long-term prevention
- **Documentation Updates**: Runbooks, monitoring guides, training materials

## Lessons Learned Section

### What Went Well
- [ ] Effective monitoring detected the issue quickly
- [ ] Clear escalation procedures were followed
- [ ] Team communication was effective during the incident
- [ ] Rollback procedures worked as expected
- [ ] Customer communication was timely and transparent

### What Could Be Improved
- [ ] Faster root cause identification process
- [ ] Better automated rollback capabilities
- [ ] More comprehensive load testing before deployment
- [ ] Improved documentation for similar incidents
- [ ] Enhanced monitoring for database connection metrics

### Process Changes Recommended
1. **Monitoring Improvements**:
   - Add alerts for database connection pool utilization > 80%
   - Implement synthetic transactions to verify end-to-end functionality

2. **Deployment Process Changes**:
   - Require load testing for any changes affecting database connections
   - Implement canary deployments for database-related changes

3. **Training and Documentation**:
   - Create runbook for database connection pool incidents
   - Conduct quarterly incident response drills

4. **Architecture Improvements**:
   - Implement circuit breakers for database connections
   - Add connection pooling at the application level as backup

## Prevention and Detection

### Prevention Measures
- **Technical**: [Specific technical changes to prevent recurrence]
- **Process**: [Process improvements to catch issues earlier]
- **Training**: [Training needs for team members]

### Detection Improvements
- **Monitoring**: [New alerts or improved existing alerts]
- **Logging**: [Enhanced logging for better debugging]
- **Testing**: [Improved test coverage for similar scenarios]

## Customer Impact Assessment

### Affected Customers
- **Total Customers Affected**: [Number]
- **Critical Customers Affected**: [Number of high-value customers]
- **Geographic Impact**: [Regions affected]

### Business Impact
- **Revenue Impact**: [Estimated financial impact]
- **Reputation Impact**: [Customer trust, brand reputation]
- **Operational Impact**: [Internal productivity, support load]

### Customer Communication
- **Notification Sent**: [Yes/No, timing]
- **Communication Channels**: [Email, status page, direct contact]
- **Customer Feedback**: [Summary of customer responses]

## Approval and Sign-off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Incident Commander | | | |
| Technical Lead | | | |
| Product Manager | | | |
| Customer Success | | | |
| Executive Sponsor | | | |

---

**Postmortem Completion Checklist**:
- [ ] Timeline is complete and accurate
- [ ] Root cause is clearly identified
- [ ] All action items have owners and due dates
- [ ] Lessons learned are documented
- [ ] Prevention measures are specific and actionable
- [ ] Customer impact is assessed
- [ ] All stakeholders have reviewed and approved
- [ ] Postmortem is shared with relevant teams
- [ ] Action items are tracked in project management system

**Distribution List**:
- [ ] Engineering Team
- [ ] Product Team
- [ ] Customer Success Team
- [ ] Executive Leadership
- [ ] Security Team (if applicable)
- [ ] Compliance Team (if applicable)

---
*This template should be completed within 72 hours of incident resolution. Store completed postmortems in `docs/postmortems/YYYY-MM-DD-incident-summary.md`.*