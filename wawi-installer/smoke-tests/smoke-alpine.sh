#!/usr/bin/env bash
# Smoke: Alpine
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
INSTALLER_DIR="$(cd -- "$SCRIPT_DIR/.." &>/dev/null && pwd)"
COMMON_SH="$INSTALLER_DIR/lib/common.sh"

echo "=== Smoke: Alpine ==="
echo "Datum: $(date -Iseconds)"

bash -n "$INSTALLER_DIR/install-alpine.sh" && echo "[PASS] install-alpine.sh syntax" || { echo "[FAIL] syntax"; exit 1; }
bash -n "$COMMON_SH" && echo "[PASS] common.sh syntax" || { echo "[FAIL] common syntax"; exit 1; }

# shellcheck source=/dev/null
source "$COMMON_SH"

# Auf Debian Host erwarten wir dass alpine Validierung fehlschlaegt - testen wir Funktionen statisch
echo "--- Statische Checks Alpine ---"
for pat in "apk update" "apk add.*git" "apk add.*curl" "ca-certificates" "command -v git|require_command git" "docker --version" "docker compose version" "validate_environment" "Git installation failed" "update-ca-certificates"; do
    if grep -qE -- "$pat" "$INSTALLER_DIR/install-alpine.sh"; then
        echo "[PASS] pattern: $pat"
    else
        echo "[FAIL] pattern fehlt: $pat"; exit 1; fi
done
for pat in "apk update" "apk.*docker" "docker-cli-compose"; do
    if grep -qE -- "$pat" "$COMMON_SH"; then
        echo "[PASS] common pattern: $pat"
    else
        echo "[FAIL] common pattern fehlt: $pat"; exit 1; fi
done

# Alpine validate wird auf Debian Host fehlschlagen - pruefe nur dass sie sauber fehlschlaegt mit Meldung
echo "--- validate_environment alpine (erwartet FAIL auf Debian Host) ---"
set +e
output="$(validate_environment "alpine" "docker" 2>&1)"
ec=$?
set -e
if [[ $ec -ne 0 ]]; then
    echo "[PASS] validate_environment alpine korrekt fehlgeschlagen auf Debian Host (exit $ec)"
    echo "      Output: $(echo "$output" | tail -n3)"
else
    echo "[INFO] validate_environment alpine unerwartet bestanden auf Debian Host - evtl. alpine Tools vorhanden"
fi

# Docker Container Test: starte kurz einen Alpine Container und fuehre Installer-Pruefung aus (wenn Docker verfuegbar)
if command -v docker &>/dev/null; then
    echo "--- Live Alpine Container Test (docker) ---"
    if docker info &>/dev/null 2>&1; then
        echo "[i] Versuche Alpine Container smoke..."
        set +e
        docker run --rm alpine:3.20 sh -c '
            set -e
            echo "[container] OS: $(cat /etc/alpine-release)"
            apk update
            apk add --no-cache git curl ca-certificates bash
            echo "[container] command -v git: $(command -v git)"
            git --version
            command -v curl && curl --version | head -n1
            test -f /etc/ssl/certs/ca-bundle.crt || test -f /etc/ssl/certs/ca-certificates.crt && echo "[container] ca-certificates OK"
            command -v bash && bash --version | head -n1
            echo "[container] OK"
        ' 2>&1 | head -n 40
        ec2=$?
        set -e
        if [[ $ec2 -eq 0 ]]; then
            echo "[PASS] Live Alpine container smoke"
        else
            echo "[WARN] Live Alpine container smoke exit $ec2 (evtl. kein Docker Zugriff)"
        fi
    else
        echo "[SKIP] docker info fehlgeschlagen - kein Live Alpine Test"
    fi
else
    echo "[SKIP] docker nicht verfuegbar - kein Live Alpine Test"
fi

echo "[OK] Smoke Alpine PASSED (statisch)"
