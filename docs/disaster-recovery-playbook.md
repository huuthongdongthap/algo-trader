# Disaster Recovery Playbook — AlgoTrader

**RTO:** 4 hours | **RPO:** 24 hours
**Architecture:** CF Pages (frontend) + M1 Max backend via CF Tunnel

---

## Contact

- On-call: [YOUR_NAME] — [YOUR_PHONE]
- Backup: [BACKUP_NAME] — [BACKUP_PHONE]

---

## Scenario A: M1 Max Backend Down

**Symptoms:** API calls fail, dashboard shows connection error

```bash
# SSH to M1 Max
sshpass -p '<password>' ssh -o StrictHostKeyChecking=no macbook@192.168.11.111

# Check PM2 processes
export PATH=/opt/homebrew/bin:$PATH
pm2 list
pm2 logs algo-trade --lines 50

# Restart services
pm2 restart algo-trade
pm2 restart all        # if multiple services down

# Check CF Tunnel
pm2 list | grep cloudflared
pm2 restart cloudflared
```

**Expected recovery time:** 15–30 min

---

## Scenario B: Database Corruption

**Symptoms:** App errors referencing DB reads, JSON parse errors

```bash
# On M1 Max: list backups
ls -lht /Users/macbook/algo-trader/backups/

# Restore latest backup (example for paper-trades)
cp /Users/macbook/algo-trader/backups/paper-trades_YYYYMMDD_HHMMSS.json \
   /Users/macbook/algo-trader/data/paper-trades.json

# Restart app
pm2 restart algo-trade
```

**Expected recovery time:** 30–60 min

---

## Scenario C: CF Pages Frontend Down

**Symptoms:** Dashboard URL returns 5xx or blank page

```bash
# Redeploy from git (trigger CF Pages auto-build)
git push origin main

# Or manual via Wrangler
npx wrangler pages deploy dist --project-name=algo-trader
```

**Expected recovery time:** 5–15 min

---

## Scenario D: CF Tunnel Down

**Symptoms:** Backend API unreachable from internet, CF Pages can't reach M1 Max

```bash
# On M1 Max
export PATH=/opt/homebrew/bin:$PATH
pm2 restart cloudflared

# Verify tunnel active
cloudflared tunnel list
cloudflared tunnel info algo-trader
```

**Expected recovery time:** 5–10 min

---

## PM2 Quick Reference

```bash
pm2 list                  # show all processes + status
pm2 restart <name>        # restart by name
pm2 logs <name> --lines 50 # tail logs
pm2 save                  # persist process list for auto-restart
pm2 startup               # enable PM2 on system boot
pm2 monit                 # live monitoring dashboard
```

---

## Backup Schedule

- Daily cron: `0 2 * * * /Users/macbook/algo-trader/scripts/backup-db.sh`
- Retention: 7 days
- Location: `/Users/macbook/algo-trader/backups/`
