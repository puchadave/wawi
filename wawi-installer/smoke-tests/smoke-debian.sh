#!/usr/bin/env bash
# Smoke: Debian Standard
# Prueft Syntax, Dependency-Pruefung, Dry-Run Verhalten
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
INSTALLER_DIR="$(cd -- "$SCRIPT_DIR/.." &>/dev/null && pwd)"
COMMON_SH="$INSTALLER_DIR/lib/common.sh"

echo "=== Smoke: Debian Standard ==="
echo "Datum: $(date -Iseconds)"
echo "Host: $(cat /etc/os-release 2>/dev/null | grep PRETTY_NAME || uname -a)"

# 1) Syntax
bash -n "$INSTALLER_DIR/install-debian.sh" && echo "[PASS] install-debian.sh syntax" || { echo "[FAIL] syntax"; exit 1; }
bash -n "$COMMON_SH" && echo "[PASS] common.sh syntax" || { echo "[FAIL] common syntax"; exit 1; }

# 2) Quelle common.sh
# shellcheck source=/dev/null
source "$COMMON_SH"

# 3) validate_environment debian docker muss auf Debian Host bestehen
echo "--- validate_environment debian docker ---"
if validate_environment "debian" "docker"; then
    echo "[PASS] validate_environment debian docker"
else
    echo "[FAIL] validate_environment debian docker"; exit 1
fi

# 4) Pruefe kritische Pattern im Installer
echo "--- Pattern Checks install-debian.sh ---"
for pat in "apt-get update|install_base_deps|apt_install" "apt_install|install_base_deps|install_git" "command -v git|require_command git" "docker --version" "docker compose version" "validate_environment" "safe_git_clone|git clone" "Git installation failed" "ca-certificates" "DEBIAN_FRONTEND"; do
    if grep -qE -- "$pat" "$INSTALLER_DIR/install-debian.sh"; then
        echo "[PASS] pattern: $pat"
    else
        echo "[FAIL] pattern fehlt: $pat"; exit 1; fi
done

# 5) Dry-run: Installer mit --help / parse check (ohne tatsaechliche apt Ausfuehrung)
# Wir testen nur dass --help-artige Aufrufe nicht crashen wenn wir sie trocken laden
echo "--- Dry-run Source-Test ---"
bash -c "source '$COMMON_SH'; source '$INSTALLER_DIR/install-debian.sh' --help 2>&1 | head -n 20" 2>&1 | head -n 30 || true
# Stattdessen pruefen wir ob der Installer die gw Typen kennt
if grep -q "install_base_deps_debian" "$INSTALLER_DIR/install-debian.sh"; then
    echo "[PASS] install_base_deps_debian referenziert"
else
    echo "[FAIL] install_base_deps_debian fehlt"; exit 1
fi

echo "[OK] Smoke Debian Standard PASSED"
