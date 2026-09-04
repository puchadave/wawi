#!/usr/bin/env bash
# Smoke: Debian Minimal
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
INSTALLER_DIR="$(cd -- "$SCRIPT_DIR/.." &>/dev/null && pwd)"
COMMON_SH="$INSTALLER_DIR/lib/common.sh"

echo "=== Smoke: Debian Minimal ==="
echo "Datum: $(date -Iseconds)"

bash -n "$INSTALLER_DIR/install-debian-minimal.sh" && echo "[PASS] install-debian-minimal.sh syntax" || { echo "[FAIL] syntax"; exit 1; }
bash -n "$COMMON_SH" && echo "[PASS] common.sh syntax" || { echo "[FAIL] common syntax"; exit 1; }

# shellcheck source=/dev/null
source "$COMMON_SH"

echo "--- validate_environment debian-minimal docker ---"
if validate_environment "debian-minimal" "docker"; then
    echo "[PASS] validate_environment debian-minimal docker"
else
    echo "[FAIL] validate_environment debian-minimal docker"; exit 1
fi

echo "--- Pattern Checks install-debian-minimal.sh ---"
for pat in "--no-install-recommends" "apt-get update|install_base_deps|apt_install" "docker.io" "command -v git|require_command git" "docker --version" "validate_environment" "Git installation failed" "ca-certificates"; do
    if grep -qE -- "$pat" "$INSTALLER_DIR/install-debian-minimal.sh"; then
        echo "[PASS] pattern: $pat"
    else
        echo "[FAIL] pattern fehlt: $pat"; exit 1; fi
done

# Sicherstellen dass minimal NICHT das offizielle Docker-Repo nutzt (kein docker-ce im Minimal)
if grep -q "docker-ce" "$INSTALLER_DIR/install-debian-minimal.sh"; then
    echo "[WARN] Minimal enthaelt docker-ce (sollte docker.io nutzen) - optional docker-compose-plugin ist OK"
    # nur warnen, nicht failen wenn zusaetzlich plugin installiert wird
fi

echo "[OK] Smoke Debian Minimal PASSED"
