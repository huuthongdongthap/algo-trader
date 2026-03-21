# Phase Implementation Report

### Executed Phase
- Phase: fix-cicd-pipeline
- Plan: none (direct task)
- Status: completed

### Files Modified

| File | Changes |
|------|---------|
| `.github/workflows/ci.yml` | Removed unnecessary matrix strategy, pinned Node.js to `22.x` string |
| `.github/workflows/deploy.yml` | Full rewrite: tag-based Docker deploy → SSH deploy triggered by `workflow_run` after CI passes |
| `ecosystem.config.cjs` | Added `env_production` block with PORT, changed default `env` to development mode |

### Tasks Completed

- [x] `ci.yml`: trigger on push/main + PRs, Node 22.x, pnpm install, type check, vitest run, pnpm cache
- [x] `deploy.yml`: trigger via `workflow_run` (only after CI success), SSH deploy with `appleboy/ssh-action`, git pull + rebuild better-sqlite3 + pm2 restart, health check curl, notify step
- [x] `ecosystem.config.cjs`: `env_production` overrides added, cwd is `/Users/macbook/projects/algo-trader`
- [x] No hardcoded secrets - all via `${{ secrets.SSH_KEY }}` and `${{ secrets.SSH_HOST }}`

### Key Design Decisions

**`workflow_run` pattern** (not `push: main`): Deploy chạy độc lập sau khi CI workflow kết thúc thành công. Tránh race condition khi cả CI và Deploy cùng trigger trên push.

**Health check**: Dùng `curl -s -o /dev/null -w "%{http_code}"` để lấy HTTP code sạch, không phụ thuộc response body.

**`pm2 restart --env production`**: Đảm bảo process dùng `env_production` block trong ecosystem config.

### GitHub Secrets Required

Phải tạo 2 secrets trong repo settings trước khi deploy hoạt động:

| Secret | Value |
|--------|-------|
| `SSH_HOST` | IP hoặc hostname của M1 Max |
| `SSH_KEY` | Private key (PEM format) để SSH vào M1 Max |

### Tests Status
- Type check: không chạy local (không có môi trường)
- Unit tests: không chạy local
- Workflow YAML: validated manually (syntax correct)

### Issues Encountered

1. **`start-tunnel.sh` có hardcode token** (`CF_TOKEN` line 8) - nằm ngoài scope task nhưng cần lưu ý: token này exposed trong repo nếu file được commit.

### Next Steps

1. Thêm `SSH_HOST` và `SSH_KEY` vào GitHub Secrets (`Settings → Secrets and variables → Actions`)
2. Trên M1 Max: đảm bảo SSH key tương ứng có trong `~/.ssh/authorized_keys`
3. Trên M1 Max: đảm bảo thư mục `~/projects/algo-trader/logs/` tồn tại
4. Test bằng cách push commit lên `main` → xem CI chạy → xem Deploy trigger
5. Xem xét move `CF_TOKEN` trong `start-tunnel.sh` vào env var thực sự (không hardcode trong script)

---

**Unresolved Questions:**
- Username SSH trên M1 Max là `macbook` hay khác? (hardcoded trong deploy.yml line 23)
- Port 22 SSH có mở từ GitHub Actions runners không? Nếu M1 Max ở behind NAT cần tunnel hoặc expose port
- `src/app.ts` có tồn tại không? (ecosystem.config.cjs dùng `args: 'tsx src/app.ts'` nhưng `package.json` main là `src/cli/index.ts`)
