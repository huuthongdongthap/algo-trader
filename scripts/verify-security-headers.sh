#!/usr/bin/env bash
# Verify security headers for cashclaw.cc and api.cashclaw.cc
# Exit 1 if any critical header is missing

DOMAINS=("https://cashclaw.cc" "https://api.cashclaw.cc")
FAILED=0

check_header() {
  local url=$1
  local header=$2
  local label=$3
  local response
  response=$(curl -sI --max-time 10 "$url" 2>/dev/null)
  if echo "$response" | grep -qi "^${header}:"; then
    echo "  PASS  $label"
  else
    echo "  FAIL  $label (missing)"
    FAILED=$((FAILED + 1))
  fi
}

for domain in "${DOMAINS[@]}"; do
  echo ""
  echo "=== $domain ==="
  check_header "$domain" "strict-transport-security" "HSTS"
  check_header "$domain" "x-frame-options" "X-Frame-Options"
  check_header "$domain" "x-content-type-options" "X-Content-Type-Options"
  check_header "$domain" "content-security-policy" "Content-Security-Policy"
  check_header "$domain" "permissions-policy" "Permissions-Policy"
done

echo ""
if [ "$FAILED" -gt 0 ]; then
  echo "RESULT: FAIL — $FAILED critical header(s) missing"
  exit 1
else
  echo "RESULT: PASS — all security headers present"
  exit 0
fi
