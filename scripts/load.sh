#!/bin/sh
# scripts/load.sh — leichte Lastprobe (POSIX sh, nur curl + python3, keine neue Dep)
# 50x GET /api/products?limit=20 parallel, misst p50/p95, prueft RateLimit 429
# Aufruf: BASE_URL=http://127.0.0.1:8080 sh scripts/load.sh
#         BASE_URL=http://127.0.0.1:8080 CONCURRENCY=50 REQUESTS=100 sh scripts/load.sh
set -eu

BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
CONCURRENCY="${CONCURRENCY:-20}"
REQUESTS="${REQUESTS:-50}"
LOG_FILE="${LOG_FILE:-scripts/load.log}"

mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
: > "$LOG_FILE" 2>/dev/null || true

echo "=== WaWi Load $(date -Is 2>/dev/null || date) BASE=$BASE_URL CONCURRENCY=$CONCURRENCY REQUESTS=$REQUESTS ===" | tee -a "$LOG_FILE"

# Warmup single request to ensure service is up
warm_code=$(curl -s -o /tmp/load_warm -w "%{http_code}" "$BASE_URL/health" 2>/dev/null || echo "000")
echo "warmup GET /health -> $warm_code" | tee -a "$LOG_FILE"
if [ "$warm_code" != "200" ] && [ "$warm_code" != "503" ]; then
  echo "[WARN] warmup failed $warm_code — continuing anyway" | tee -a "$LOG_FILE"
fi

TMPDIR_LOAD=$(mktemp -d /tmp/wawi-load-XXXX)
trap 'rm -rf "$TMPDIR_LOAD"' EXIT INT TERM

# Fire requests in parallel via xargs -P
seq 1 "$REQUESTS" | xargs -P "$CONCURRENCY" -I {} sh -c '
  url="$1/api/products?limit=20"
  out="$2/out-{}"
  start=$(date +%s%3N 2>/dev/null || date +%s)
  code=$(curl -s -o "$out" -w "%{http_code}" "$url" 2>/dev/null || echo "000")
  end=$(date +%s%3N 2>/dev/null || date +%s)
  # fallback if %3N not supported (busybox date)
  if [ "$start" = "$end" ] && [ "$code" != "000" ]; then
    # estimate 3-digit ms via python if available
    :
  fi
  # compute duration ms via python if %3N unsupported: use python time
  # we store start/end as epoch ms when possible, else use shell
  echo "$code $start $end" > "$2/meta-{}"
' -- "$BASE_URL" "$TMPDIR_LOAD" 2>&1 | tee -a "$LOG_FILE" || true

# Collect results
python3 <<'PY' 2>&1 | tee -a "$LOG_FILE"
import pathlib, glob, statistics, os, re

tmp = os.environ.get("TMPDIR_LOAD", "") or "/tmp"
# find meta files from mktemp
import subprocess, json
# locate latest wawi-load dir
import glob as g
dirs = g.glob("/tmp/wawi-load-*")
if not dirs:
    print("[WARN] no load tmp dirs found")
    raise SystemExit(0)
d = sorted(dirs)[-1]
metas = g.glob(f"{d}/meta-*")
codes = []
durs = []
for mf in metas:
    try:
        txt = pathlib.Path(mf).read_text().strip()
        parts = txt.split()
        if not parts: continue
        code = parts[0]
        codes.append(code)
        # duration: if we have 3 parts, second+third are ms timestamps
        if len(parts) >= 3:
            try:
                s = int(parts[1]); e = int(parts[2])
                # if s/e are seconds (10 digits) vs ms (13 digits), normalize
                if s < 10000000000: s *= 1000
                if e < 10000000000: e *= 1000
                durs.append(max(0, e - s))
            except: pass
    except: pass

total = len(codes)
ok = sum(1 for c in codes if c == "200")
rate_limited = sum(1 for c in codes if c == "429")
err = sum(1 for c in codes if c not in ("200","429"))
print(f"requests: {total} ok(200)={ok} rate_limited(429)={rate_limited} error(other)={err}")
if durs:
    durs_sorted = sorted(durs)
    n = len(durs_sorted)
    def pct(p):
        idx = int(n * p / 100)
        idx = max(0, min(n-1, idx))
        return durs_sorted[idx]
    p50 = pct(50); p95 = pct(95); p99 = pct(99)
    avg = sum(durs_sorted)/n if n else 0
    print(f"durationMs: avg={avg:.1f} p50={p50} p95={p95} p99={p99} min={min(durs_sorted)} max={max(durs_sorted)}")
    # pass/fail heuristic: p95 < 800ms (Richtwert, nicht hart failen)
    if p95 > 800:
        print(f"[WARN] p95 {p95}ms > 800ms Richtwert — pruefen ob DB/Redis ausgelastet")
    else:
        print(f"[OK] p95 {p95}ms within 800ms budget")
else:
    print("[INFO] keine Dauer-Messung (date +%3N nicht verfuegbar) — nur Code-Verteilung ausgewertet")
    # fallback duration via python time not implemented in shell variant; still pass if ok rate high
if total > 0 and ok + rate_limited >= int(total * 0.95):
    print("[OK] load: >=95% requests ok oder rate-limited (erwartet)")
else:
    print(f"[WARN] load: nur {ok+rate_limited}/{total} ok+429 — moegliche Ueberlastung")
PY

# Append raw meta for debugging
echo "--- raw meta (first 10) ---" >> "$LOG_FILE"
ls -1 "$TMPDIR_LOAD"/meta-* 2>/dev/null | head -n 10 | xargs -I {} sh -c 'echo "{}: $(cat {})"' >> "$LOG_FILE" 2>&1 || true

echo "load done — log $LOG_FILE" | tee -a "$LOG_FILE"
