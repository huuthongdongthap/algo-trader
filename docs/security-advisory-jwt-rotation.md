# Security Advisory: JWT Secret Rotation

**Date:** 2026-03-26
**Severity:** High
**Status:** Mitigated

## Incident Summary

An old JWT secret (`413da7ec...`) was committed to the public repo in `ecosystem.config.cjs`.
The secret has since been **rotated** — a new secret is now stored in `.env` (gitignored).

## Impact

- All tokens signed with the old secret are **cryptographically invalid**
- Any active sessions using the old secret were automatically invalidated upon rotation
- No data breach is confirmed from this exposure

## Current State

- New JWT secret: stored in `.env` (never committed to git)
- `.env` is listed in `.gitignore` — enforced

## Recommended Manual Cleanup (One-Time)

To fully purge the old secret from git history on the **public repo**, run:

```bash
# Install git-filter-repo (preferred over BFG)
pip3 install git-filter-repo

# Replace the exposed secret across all commits
git filter-repo --replace-text <(echo '413da7ec==>REDACTED')

# Force-push all branches (coordinate with team first)
git push origin --force --all
```

> Note: Force-push will rewrite history. All collaborators must re-clone.
> Run this during a maintenance window.

## Prevention

- Use `.env` for all secrets — never hardcode in config files
- Pre-commit hook (`husky`) scans for common secret patterns
- Rotate secrets immediately if exposure is suspected
