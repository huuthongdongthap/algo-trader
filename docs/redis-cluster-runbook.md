# Redis Cluster Operations Runbook

**Version:** 1.0.0
**Last Updated:** 2026-03-22
**Cluster:** 6 nodes (3 masters + 3 replicas)

---

## Quick Reference

| Service | Ports | Command |
|---------|-------|---------|
| Master 0 | 7000/17000 | `redis-cli -p 7000` |
| Master 1 | 7001/17001 | `redis-cli -p 7001` |
| Master 2 | 7002/17002 | `redis-cli -p 7002` |
| Replica 3 | 7003/17003 | `redis-cli -p 7003` |
| Replica 4 | 7004/17004 | `redis-cli -p 7004` |
| Replica 5 | 7005/17005 | `redis-cli -p 7005` |

---

## Startup Sequence

### 1. Start Cluster

```bash
# Start all 6 nodes
cd /Users/macbook/mekong-cli/apps/algo-trader
docker-compose -f docker-compose.redis-cluster.yml up -d

# Wait for nodes ready (30s)
sleep 30

# Initialize cluster (first time only)
./scripts/redis-cluster-init.sh
```

### 2. Verify Cluster Health

```bash
# Cluster info
redis-cli -p 7000 CLUSTER INFO

# Expected output:
# cluster_state:ok
# cluster_slots_assigned:16384
# cluster_slots_ok:16384
# cluster_known_nodes:6
```

---

## Health Checks

### Daily Checks

```bash
# 1. Cluster state
redis-cli -p 7000 CLUSTER INFO | grep -E "cluster_state|cluster_slots"

# 2. Node connectivity
redis-cli -p 7000 CLUSTER NODES | wc -l  # Should be 6+

# 3. Memory usage per node
for port in 7000 7001 7002 7003 7004 7005; do
  echo "Node $port:"
  redis-cli -p $port INFO memory | grep used_memory_human
done

# 4. Client connections
redis-cli -p 7000 CLIENT LIST | wc -l
```

### Monitoring Metrics

| Metric | Warning | Critical |
|--------|---------|----------|
| cluster_state | != ok | != ok |
| cluster_slots_ok | < 16384 | < 10000 |
| Memory usage | > 80% | > 95% |
| Connected clients | > 500 | > 1000 |
| Replication lag | > 5s | > 30s |

---

## Failover Testing

### Manual Failover Test

```bash
# 1. Identify master and its replica
redis-cli -p 7000 CLUSTER NODES | grep master
redis-cli -p 7000 CLUSTER NODES | grep slave

# 2. Simulate master failure
docker stop algo-trader-redis-node-0

# 3. Wait for failover (cluster-node-timeout: 5s)
sleep 10

# 4. Verify new master elected
redis-cli -p 7001 CLUSTER NODES

# 5. Restart failed node
docker start algo-trader-redis-node-0

# 6. Verify node rejoins as replica
sleep 10
redis-cli -p 7001 CLUSTER NODES
```

### Expected Failover Time

- Detection: 5s (cluster-node-timeout)
- Election: < 2s
- Total: < 10s

---

## Backup & Restore

### Backup (RDB Snapshots)

```bash
# Trigger BGSAVE on all masters
for port in 7000 7001 7002; do
  redis-cli -p $port BGSAVE
done

# Wait for completion
sleep 30

# Copy RDB files
docker cp algo-trader-redis-node-0:/data/dump-7000.rdb ./backups/
docker cp algo-trader-redis-node-1:/data/dump-7001.rdb ./backups/
docker cp algo-trader-redis-node-2:/data/dump-7002.rdb ./backups/
```

### Restore from Backup

```bash
# Stop cluster
docker-compose -f docker-compose.redis-cluster.yml down

# Copy backup files
docker cp ./backups/dump-7000.rdb algo-trader-redis-node-0:/data/
docker cp ./backups/dump-7001.rdb algo-trader-redis-node-1:/data/
docker cp ./backups/dump-7002.rdb algo-trader-redis-node-2:/data/

# Start cluster
docker-compose -f docker-compose.redis-cluster.yml up -d

# Initialize (nodes will load RDB automatically)
./scripts/redis-cluster-init.sh
```

---

## Troubleshooting

### Issue: Cluster State = FAIL

```bash
# 1. Check which nodes are down
redis-cli -p 7000 CLUSTER NODES | grep -E "fail|disconnected"

# 2. Check node logs
docker-compose -f docker-compose.redis-cluster.yml logs redis-node-0

# 3. Restart failed nodes
docker restart algo-trader-redis-node-X

# 4. If slots not covered, trigger failover
redis-cli -p 7000 CLUSTER FAILOVER
```

### Issue: Slot Coverage < 16384

```bash
# Check slot assignment
redis-cli -p 7000 CLUSTER SLOTS

# Fix: Add missing slots
redis-cli --cluster fix 127.0.0.1:7000

# Or: Reshard if needed
redis-cli --cluster reshard 127.0.0.1:7000
```

### Issue: High Memory Usage

```bash
# Check memory per node
for port in 7000 7001 7002 7003 7004 7005; do
  echo "Node $port:"
  redis-cli -p $port INFO memory | grep used_memory_human
done

# Evict old keys (if maxmemory-policy set)
redis-cli -p 7000 MEMORY DOCTOR

# Flush specific database (CAUTION: data loss)
redis-cli -p 7000 FLUSHDB
```

---

## Performance Tuning

### Current Configuration

```
--cluster-node-timeout 5000      # Failover detection
--appendonly yes                 # AOF persistence
--maxmemory-policy allkeys-lru   # Eviction policy
```

### Scaling Options

1. **Add more masters** (increase slots distribution):
   ```bash
   redis-cli --cluster add-node 127.0.0.1:7006 127.0.0.1:7000
   redis-cli --cluster reshard 127.0.0.1:7000
   ```

2. **Add more replicas** (improve read throughput):
   ```bash
   redis-cli --cluster add-node 127.0.0.1:7006 127.0.0.1:7000 --cluster-slave
   ```

---

## Useful Commands

```bash
# Full cluster info
redis-cli -p 7000 CLUSTER INFO

# Node topology
redis-cli -p 7000 CLUSTER NODES

# Slot distribution
redis-cli -p 7000 CLUSTER SLOTS

# Keys in slot
redis-cli -p 7000 CLUSTER GETKEYSINSLOT <slot> <count>

# Save cluster config
redis-cli -p 7000 CLUSTER SAVECONFIG

# Reset cluster (DESTRUCTIVE)
redis-cli -p 7000 CLUSTER RESET HARD
```

---

## Environment Variables

```bash
# .env for cluster mode
REDIS_CLUSTER_HOST=127.0.0.1
REDIS_CLUSTER_PASSWORD=  # Optional
REDIS_CLUSTER_ENABLED=true
```

---

**Next Review:** 2026-04-22
**Owner:** DevOps Team
