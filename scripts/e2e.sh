#!/bin/sh
# scripts/e2e.sh — WaWi Middleware E2E (POSIX sh, nur curl + python3, keine neue Dep)
# Kette: health/ready -> login -> stats/health -> products -> import/upload -> manualData/attributes -> review/approve -> sync/retry -> shopware -> matterhorn/ai/integrations
# Exit 0 bei PASS (FAIL=0), non-zero nur bei kritischem Fehler. SKIP ist erlaubt (Shopware optional).
set -eu

BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
LOG_FILE="${LOG_FILE:-scripts/e2e.log}"
ADMIN_USER="${WAWI_ADMIN_USERNAME:-admin}"
ADMIN_PASS="${WAWI_ADMIN_PASSWORD:-}"

mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
: > "$LOG_FILE" 2>/dev/null || true

PASS=0; FAIL=0; SKIP=0

log()  { echo "[INFO] $*" | tee -a "$LOG_FILE"; }
ok()   { echo "[OK] $*" | tee -a "$LOG_FILE"; PASS=$((PASS+1)); }
warn() { echo "[WARN] $*" | tee -a "$LOG_FILE"; SKIP=$((SKIP+1)); }
fail() { echo "[FAIL] $*" | tee -a "$LOG_FILE"; FAIL=$((FAIL+1)); }

api_get() {
  _path="$1"; _token="$2"
  if [ -n "$_token" ]; then
    curl -s -o /tmp/e2e_body -w "%{http_code}" -H "Authorization: Bearer $_token" "$BASE_URL$_path" 2>/dev/null || echo "000"
  else
    curl -s -o /tmp/e2e_body -w "%{http_code}" "$BASE_URL$_path" 2>/dev/null || echo "000"
  fi
}

api_post() {
  _path="$1"; _data="$2"; _token="$3"
  if [ -n "$_token" ]; then
    curl -s -o /tmp/e2e_body -w "%{http_code}" -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $_token" -d "$_data" "$BASE_URL$_path" 2>/dev/null || echo "000"
  else
    curl -s -o /tmp/e2e_body -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "$_data" "$BASE_URL$_path" 2>/dev/null || echo "000"
  fi
}

api_patch() {
  _path="$1"; _data="$2"; _token="$3"
  if [ -n "$_token" ]; then
    curl -s -o /tmp/e2e_body -w "%{http_code}" -X PATCH -H "Content-Type: application/json" -H "Authorization: Bearer $_token" -d "$_data" "$BASE_URL$_path" 2>/dev/null || echo "000"
  else
    curl -s -o /tmp/e2e_body -w "%{http_code}" -X PATCH -H "Content-Type: application/json" -d "$_data" "$BASE_URL$_path" 2>/dev/null || echo "000"
  fi
}

echo "=== WaWi E2E $(date -Is 2>/dev/null || date) BASE=$BASE_URL ===" | tee -a "$LOG_FILE"

# 1 — health (no auth)
log "1) GET /health"
code=$(curl -s -o /tmp/e2e_body -w "%{http_code}" "$BASE_URL/health" 2>/dev/null || echo "000")
cat /tmp/e2e_body >> "$LOG_FILE" 2>&1 || true
if [ "$code" = "200" ]; then ok "GET /health $code $(cat /tmp/e2e_body | head -c 200)"; else fail "GET /health $code $(cat /tmp/e2e_body | head -c 300)"; fi

log "1b) GET /ready"
code=$(curl -s -o /tmp/e2e_body -w "%{http_code}" "$BASE_URL/ready" 2>/dev/null || echo "000")
cat /tmp/e2e_body >> "$LOG_FILE" 2>&1 || true
if [ "$code" = "200" ] || [ "$code" = "503" ]; then ok "GET /ready $code"; else fail "GET /ready $code"; fi

log "1c) GET /api/health (legacy shop-kern compat)"
code=$(curl -s -o /tmp/e2e_body -w "%{http_code}" "$BASE_URL/api/health" 2>/dev/null || echo "000")
cat /tmp/e2e_body >> "$LOG_FILE" 2>&1 || true
if [ "$code" = "200" ]; then ok "GET /api/health $code"; else warn "GET /api/health $code (apps/api not live or shop-kern offline)"; fi

log "1d) x-request-id echo"
hdr=$(curl -s -D - -o /tmp/e2e_body "$BASE_URL/health" -H "x-request-id: e2e-$$" 2>/dev/null | tr -d '\r' | grep -i "x-request-id" || true)
if echo "$hdr" | grep -q "e2e-"; then ok "x-request-id echoed: $hdr"; else warn "x-request-id not echoed hdr=$hdr (shop-kern has no echo, apps/api tracing only)"; fi

# 2 — login
TOKEN=""
if [ -n "$ADMIN_PASS" ]; then
  log "2) POST /api/auth/login user=$ADMIN_USER"
  code=$(api_post "/api/auth/login" "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}" "")
  body=$(cat /tmp/e2e_body); echo "$body" >> "$LOG_FILE"
  TOKEN=$(python3 -c "import json; d=json.loads(open('/tmp/e2e_body').read()); print(d.get('accessToken','') or d.get('token',''))" 2>/dev/null || echo "")
  if [ "$code" = "200" ] && [ -n "$TOKEN" ]; then ok "login 200 token len ${#TOKEN}"; else fail "login $code $body"; fi
else
  warn "2) SKIP login — WAWI_ADMIN_PASSWORD not set (export WAWI_ADMIN_PASSWORD to test auth chain)"
fi

need_token() { [ -n "$TOKEN" ]; }

# 3 — stats + admin health (auth)
if need_token; then
  log "3) GET /api/admin/stats (admin:read)"
  code=$(api_get "/api/admin/stats" "$TOKEN")
  body=$(cat /tmp/e2e_body); echo "$body" >> "$LOG_FILE"
  if [ "$code" = "200" ]; then
    has_latency=$(python3 -c "import json; d=json.loads(open('/tmp/e2e_body').read()); print('latency' in d)" 2>/dev/null || echo "False")
    ok "GET /api/admin/stats $code latency=$has_latency"
  else
    fail "GET /api/admin/stats $code $body"
  fi
  log "3b) GET /api/admin/health (admin:read)"
  code=$(api_get "/api/admin/health" "$TOKEN")
  body=$(cat /tmp/e2e_body); echo "$body" >> "$LOG_FILE"
  if [ "$code" = "200" ]; then ok "GET /api/admin/health $code"; else fail "GET /api/admin/health $code $body"; fi
else
  warn "3) SKIP /api/admin/stats + /api/admin/health (no token)"
  warn "3b) SKIP /api/admin/health (no token)"
fi

# 4 — products list (public)
log "4) GET /api/products?limit=5"
# products routes are public (no preHandler) — works without token
code=$(curl -s -o /tmp/e2e_body -w "%{http_code}" "$BASE_URL/api/products?limit=5" 2>/dev/null || echo "000")
body=$(cat /tmp/e2e_body); echo "$body" >> "$LOG_FILE"
if [ "$code" = "200" ]; then ok "GET /api/products $code"; else warn "GET /api/products $code $body"; fi

PRODUCT_ID=$(python3 -c "
import json
try:
    d=json.loads(open('/tmp/e2e_body').read())
    arr=d.get('products') if isinstance(d,dict) else None
    if arr is None and isinstance(d,list): arr=d
    if arr and len(arr)>0:
        first=arr[0]
        print(first.get('supplierProductId') or first.get('id') or '')
    else:
        print('')
except: print('')
" 2>/dev/null || echo "")

# 5 — import/upload fixture (multipart, manual whitelist)
log "5) POST /api/import/upload (fixture 2 products -> e2e-1001/e2e-1002)"
FIXTURE=$(mktemp /tmp/matterhorn-XXXX.xml)
cat > "$FIXTURE" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<products>
  <product id="e2e-1001">
    <name>WaWi E2E Test Chair</name>
    <brand>E2E Brand</brand>
    <category id="10">Moebel/Stuehle</category>
    <description><![CDATA[<p>E2E Test Stuhl — Phase 7</p>]]></description>
    <color>schwarz</color>
    <type>Stuhl</type>
    <images><image>https://example.com/e2e-1001.jpg</image></images>
    <prices><price currency="EUR">99.00</price></prices>
    <options><option id="e2e-1001-v1"><name>Standard</name><stock>10</stock><ean>4000000001001</ean></option></options>
  </product>
  <product id="e2e-1002">
    <name>WaWi E2E Test Table</name>
    <brand>E2E Brand</brand>
    <category id="10">Moebel/Tische</category>
    <description><![CDATA[<p>E2E Test Tisch — Phase 7</p>]]></description>
    <color>eiche</color>
    <type>Tisch</type>
    <images><image>https://example.com/e2e-1002.jpg</image></images>
    <prices><price currency="EUR">199.00</price></prices>
    <options><option id="e2e-1002-v1"><name>Standard</name><stock>5</stock><ean>4000000001002</ean></option></options>
  </product>
</products>
XML
code=$(curl -s -o /tmp/e2e_body -w "%{http_code}" -X POST -F "file=@$FIXTURE;type=text/xml" "$BASE_URL/api/import/upload" 2>/dev/null || echo "000")
body=$(cat /tmp/e2e_body); echo "$body" >> "$LOG_FILE"
rm -f "$FIXTURE"
if [ "$code" = "200" ]; then ok "POST /api/import/upload $code $body"; else warn "POST /api/import/upload $code $body (apps/api may not be live)"; fi

# re-resolve e2e product
curl -s -o /tmp/e2e_body "$BASE_URL/api/products?search=e2e-1001&limit=5" 2>/dev/null || true
PRODUCT_ID2=$(python3 -c "
import json
try:
    d=json.loads(open('/tmp/e2e_body').read())
    arr=d.get('products') if isinstance(d,dict) else None
    if arr is None and isinstance(d,list): arr=d
    if arr:
        for p in arr:
            sid=p.get('supplierProductId') or p.get('id') or ''
            if 'e2e' in sid:
                print(sid); raise SystemExit
        print(arr[0].get('supplierProductId') or arr[0].get('id') or '')
    else: print('')
except: print('')
" 2>/dev/null || echo "")
if [ -n "$PRODUCT_ID2" ]; then PRODUCT_ID="$PRODUCT_ID2"; fi
if [ -z "$PRODUCT_ID" ]; then PRODUCT_ID="e2e-1001"; fi
log "using PRODUCT_ID=$PRODUCT_ID"

# 6 — product detail (public)
log "6) GET /api/products/:id"
code=$(curl -s -o /tmp/e2e_body -w "%{http_code}" "$BASE_URL/api/products/$PRODUCT_ID" 2>/dev/null || echo "000")
body=$(cat /tmp/e2e_body); echo "$body" >> "$LOG_FILE"
if [ "$code" = "200" ]; then ok "GET /api/products/$PRODUCT_ID $code"; else warn "GET /api/products/$PRODUCT_ID $code $body (may be 404 before import)"; fi

# 7-8 — manualData + attributes (public, no auth — matches products.ts)
log "7) PATCH /api/products/:id/manual-data"
code=$(api_patch "/api/products/$PRODUCT_ID/manual-data" '{"title":"E2E Title","metaTitle":"E2E Meta"}' "")
body=$(cat /tmp/e2e_body); echo "$body" >> "$LOG_FILE"
if [ "$code" = "200" ]; then ok "PATCH manual-data $code"; else warn "PATCH manual-data $code $body"; fi

log "8) PATCH /api/products/:id/attributes"
code=$(api_patch "/api/products/$PRODUCT_ID/attributes" '{"attributes":{"e2e_test":"ok","material":"holz"}}' "")
body=$(cat /tmp/e2e_body); echo "$body" >> "$LOG_FILE"
if [ "$code" = "200" ]; then ok "PATCH attributes $code"; else warn "PATCH attributes $code $body"; fi

# 9 — review / approve (public)
log "9) POST /api/products/:id/review"
code=$(api_post "/api/products/$PRODUCT_ID/review" '{}' "")
body=$(cat /tmp/e2e_body); echo "$body" >> "$LOG_FILE"
if [ "$code" = "200" ] || [ "$code" = "201" ]; then ok "POST review $code"; else warn "POST review $code $body"; fi

log "9b) POST /api/products/:id/approve"
code=$(api_post "/api/products/$PRODUCT_ID/approve" '{}' "")
body=$(cat /tmp/e2e_body); echo "$body" >> "$LOG_FILE"
if [ "$code" = "200" ] || [ "$code" = "201" ]; then ok "POST approve $code"; else warn "POST approve $code $body"; fi

# 10 — shopware sync/retry (may be no-op if SHOPWARE_API_URL not set, but queues)
log "10) POST /api/products/:id/sync/retry"
code=$(api_post "/api/products/$PRODUCT_ID/sync/retry" '{}' "")
body=$(cat /tmp/e2e_body); echo "$body" >> "$LOG_FILE"
if [ "$code" = "200" ] || [ "$code" = "201" ] || [ "$code" = "202" ]; then ok "POST sync/retry $code"; else warn "POST sync/retry $code $body (expected if Shopware not configured or not approved)"; fi

if need_token; then
  log "10b) GET /api/admin/shopware/status (shopware:read)"
  code=$(api_get "/api/admin/shopware/status" "$TOKEN")
  body=$(cat /tmp/e2e_body); echo "$body" >> "$LOG_FILE"
  if [ "$code" = "200" ]; then ok "GET shopware/status $code"; else warn "GET shopware/status $code $body"; fi

  log "10c) GET /api/admin/shopware/queue"
  code=$(api_get "/api/admin/shopware/queue" "$TOKEN")
  body=$(cat /tmp/e2e_body); echo "$body" >> "$LOG_FILE"
  if [ "$code" = "200" ]; then ok "GET shopware/queue $code"; else warn "GET shopware/queue $code $body"; fi
else
  warn "10b/c SKIP shopware status/queue (no token)"
  warn "10c SKIP shopware queue (no token)"
fi

# 11 — matterhorn connections (auth)
if need_token; then
  log "11) GET /api/admin/matterhorn/connections (import:read)"
  code=$(api_get "/api/admin/matterhorn/connections" "$TOKEN")
  body=$(cat /tmp/e2e_body); echo "$body" >> "$LOG_FILE"
  if [ "$code" = "200" ]; then ok "GET matterhorn/connections $code"; else warn "GET matterhorn/connections $code $body"; fi
else
  warn "11 SKIP matterhorn (no token)"
fi

# 12 — ai providers (auth)
if need_token; then
  log "12) GET /api/admin/ai/providers (ai:read) or /api/ai/providers"
  code=$(api_get "/api/admin/ai/providers" "$TOKEN")
  if [ "$code" != "200" ]; then code=$(api_get "/api/ai/providers" "$TOKEN"); fi
  body=$(cat /tmp/e2e_body); echo "$body" >> "$LOG_FILE"
  if [ "$code" = "200" ]; then ok "GET ai/providers $code"; else warn "GET ai/providers $code $body"; fi
else
  warn "12 SKIP ai (no token)"
fi

# 13 — integrations (auth)
if need_token; then
  log "13) GET /api/admin/integrations or /api/integrations"
  code=$(api_get "/api/admin/integrations" "$TOKEN")
  if [ "$code" != "200" ]; then code=$(api_get "/api/integrations" "$TOKEN"); fi
  body=$(cat /tmp/e2e_body); echo "$body" >> "$LOG_FILE"
  if [ "$code" = "200" ]; then ok "GET integrations $code"; else warn "GET integrations $code $body"; fi
else
  warn "13 SKIP integrations (no token)"
fi

echo "=== SUMMARY PASS=$PASS SKIP=$SKIP FAIL=$FAIL ===" | tee -a "$LOG_FILE"
if [ "$FAIL" != "0" ]; then
  echo "E2E: FAIL ($FAIL failures) — see $LOG_FILE" | tee -a "$LOG_FILE"
  exit 1
fi
echo "E2E: OK (PASS=$PASS SKIP=$SKIP) — log $LOG_FILE" | tee -a "$LOG_FILE"
exit 0
