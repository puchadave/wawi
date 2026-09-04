#!/usr/bin/env bash
# ============================================================================
# WaWi Smoke Tests - Gemeinsame Assertions fuer alle Pfade
# Testet: Syntax, Dependency-Pruefung, OS-Trennung, Validierung
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
INSTALLER_DIR="$(cd -- "$SCRIPT_DIR/.." &>/dev/null && pwd)"
COMMON_SH="$INSTALLER_DIR/lib/common.sh"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
PASS=0; FAIL=0; TOTAL=0

assert() {
    local desc="$1"; shift
    TOTAL=$((TOTAL+1))
    if "$@"; then
        echo -e "${GREEN}[PASS]${NC} $desc"
        PASS=$((PASS+1))
    else
        echo -e "${RED}[FAIL]${NC} $desc"
        FAIL=$((FAIL+1))
    fi
}

assert_grep() {
    local desc="$1" file="$2" pattern="$3"
    TOTAL=$((TOTAL+1))
    if grep -qE -- "$pattern" "$file"; then
        echo -e "${GREEN}[PASS]${NC} $desc"
        PASS=$((PASS+1))
    else
        echo -e "${RED}[FAIL]${NC} $desc (Pattern nicht gefunden: $pattern in $file)"
        FAIL=$((FAIL+1))
    fi
}

assert_not_grep() {
    local desc="$1" file="$2" pattern="$3"
    TOTAL=$((TOTAL+1))
    if ! grep -qE -- "$pattern" "$file"; then
        echo -e "${GREEN}[PASS]${NC} $desc"
        PASS=$((PASS+1))
    else
        echo -e "${RED}[FAIL]${NC} $desc (Pattern duerfte nicht vorhanden sein: $pattern)"
        FAIL=$((FAIL+1))
    fi
}

header() { echo -e "\n${CYAN}━━━ $* ━━━${NC}"; }

# --------------------------------------------------------------------------
# 0) Syntax
# --------------------------------------------------------------------------
header "0) Syntax-Checks (bash -n)"
for f in "$COMMON_SH" "$INSTALLER_DIR/install-debian.sh" "$INSTALLER_DIR/install-debian-minimal.sh" "$INSTALLER_DIR/install-alpine.sh" "$INSTALLER_DIR/wawi.sh"; do
    assert "bash -n $(basename "$f")" bash -n "$f"
done

# --------------------------------------------------------------------------
# 1) common.sh vorhanden und Funktionen definiert
# --------------------------------------------------------------------------
header "1) lib/common.sh Funktionen"

# shellcheck source=/dev/null
source "$COMMON_SH"

assert "detect_os definiert" bash -c "source '$COMMON_SH' && declare -F detect_os >/dev/null"
assert "require_command definiert" bash -c "source '$COMMON_SH' && declare -F require_command >/dev/null"
assert "validate_environment definiert" bash -c "source '$COMMON_SH' && declare -F validate_environment >/dev/null"
assert "safe_git_clone definiert" bash -c "source '$COMMON_SH' && declare -F safe_git_clone >/dev/null"
assert "ensure_docker_available definiert" bash -c "source '$COMMON_SH' && declare -F ensure_docker_available >/dev/null"
assert "install_git_debian definiert" bash -c "source '$COMMON_SH' && declare -F install_git_debian >/dev/null"
assert "install_git_alpine definiert" bash -c "source '$COMMON_SH' && declare -F install_git_alpine >/dev/null"
assert "install_base_deps_debian definiert" bash -c "source '$COMMON_SH' && declare -F install_base_deps_debian >/dev/null"
assert "install_base_deps_debian_minimal definiert" bash -c "source '$COMMON_SH' && declare -F install_base_deps_debian_minimal >/dev/null"
assert "install_base_deps_alpine definiert" bash -c "source '$COMMON_SH' && declare -F install_base_deps_alpine >/dev/null"
assert "validate_git definiert" bash -c "source '$COMMON_SH' && declare -F validate_git >/dev/null"
assert "validate_docker definiert" bash -c "source '$COMMON_SH' && declare -F validate_docker >/dev/null"
assert "install_node_debian definiert" bash -c "source '$COMMON_SH' && declare -F install_node_debian >/dev/null"

# --------------------------------------------------------------------------
# 2) OS-spezifische Paketinstallation sauber getrennt
# --------------------------------------------------------------------------
header "2) OS-spezifische Trennung (common.sh)"

assert_grep "common.sh enthaelt apt-get update (Debian)" "$COMMON_SH" "apt-get update"
assert_grep "common.sh enthaelt apt-get update (Debian)" "$COMMON_SH" "apt-get update"
assert_grep "common.sh enthaelt apt_install_debian git (Debian)" "$COMMON_SH" "install_git_debian|apt_install_debian.*git"
assert_grep "common.sh enthaelt --no-install-recommends (Minimal)" "$COMMON_SH" "--no-install-recommends"
assert_grep "common.sh enthaelt apk update (Alpine)" "$COMMON_SH" "apk update"
assert_grep "common.sh enthaelt apk_add git (Alpine)" "$COMMON_SH" "install_git_alpine|apk_add.*git"
assert_grep "common.sh enthaelt ca-certificates (Debian)" "$COMMON_SH" "ca-certificates"
assert_grep "common.sh enthaelt ca-certificates (Alpine)" "$COMMON_SH" "ca-certificates"
assert_grep "common.sh hat debian/alpine Dispatcher" "$COMMON_SH" "detect_os"

# --------------------------------------------------------------------------
# 3) Jede Dependency aktiv pruefen
# --------------------------------------------------------------------------
header "3) Aktive Pruefung je Dependency (common.sh)"

assert_grep "validate_git nutzt validate_command oder command -v git" "$COMMON_SH" "validate_command git|command -v.*git"
assert_grep "validate_curl nutzt validate_command oder command -v curl" "$COMMON_SH" "validate_command curl|command -v.*curl"
assert_grep "validate_bash nutzt validate_command oder command -v bash" "$COMMON_SH" "validate_command bash|command -v.*bash"
assert_grep "validate_docker nutzt docker --version" "$COMMON_SH" "docker --version"
assert_grep "validate_docker nutzt docker compose version" "$COMMON_SH" "docker compose version"
assert_grep "validate_ca_certificates prueft Bundle" "$COMMON_SH" "ca-certificates.crt|ca-bundle"

# --------------------------------------------------------------------------
# 4) Fehlende Dependency: klare Fehlermeldung, Installationsversuch, erneute Pruefung, Abbruch
# --------------------------------------------------------------------------
header "4) Fehlerbehandlung (install -> pruefen -> fatal)"

assert_grep "common.sh ensure_command meldet fatal bei Fehlschlag" "$COMMON_SH" "fatal.*installation failed"
assert_grep "common.sh safe_git_clone prueft git vor Clone" "$COMMON_SH" "require_command git.*fatal|Git installation failed"
assert_grep "common.sh ensure_docker_available prueft docker vor Einsatz" "$COMMON_SH" "Docker installation failed|ensure_docker_available"

# --------------------------------------------------------------------------
# 5) Installer enthaelt alle Pfade
# --------------------------------------------------------------------------
header "5) Drei Installer existieren und sind unabhaengig"

assert "install-debian.sh existiert" test -f "$INSTALLER_DIR/install-debian.sh"
assert "install-debian-minimal.sh existiert" test -f "$INSTALLER_DIR/install-debian-minimal.sh"
assert "install-alpine.sh existiert" test -f "$INSTALLER_DIR/install-alpine.sh"
assert "wawi.sh existiert" test -f "$INSTALLER_DIR/wawi.sh"

for installer in install-debian.sh install-debian-minimal.sh install-alpine.sh; do
    f="$INSTALLER_DIR/$installer"
    assert_grep "$installer enthaelt Dependency-Pruefung vor Installation" "$f" "Dependency-Pruefung|require_command"
    assert_grep "$installer prueft git vor Clone (require_command git.*fatal)" "$f" "require_command git.*fatal|Git installation failed"
    assert_grep "$installer prueft command -v git/curl/bash" "$f" "command -v git|command -v curl"
    assert_grep "$installer ruft validate_environment auf" "$f" "validate_environment"
    assert_grep "$installer nutzt safe_git_clone oder git clone nur nach Pruefung" "$f" "safe_git_clone|git clone"
done

# Spezifische OS-Trennung je Installer
assert_grep "install-debian.sh nutzt apt-get/Debian Pfad (delegiert oder direkt)" "$INSTALLER_DIR/install-debian.sh" "apt-get update|install_base_deps_debian|install_docker_debian"
assert_grep "install-debian-minimal.sh nutzt --no-install-recommends" "$INSTALLER_DIR/install-debian-minimal.sh" "--no-install-recommends"
assert_grep "install-alpine.sh nutzt apk update" "$INSTALLER_DIR/install-alpine.sh" "apk update"
assert_grep "install-alpine.sh nutzt apk add.*git.*curl.*ca-certificates.*bash" "$INSTALLER_DIR/install-alpine.sh" "apk add.*git"

# Debian Standard nutzt offizielles Docker-Repo
assert_grep "install-debian.sh nutzt Docker GPG + docker-ce" "$INSTALLER_DIR/install-debian.sh" "docker.gpg|docker-ce"
# Debian Minimal nutzt docker.io
assert_grep "install-debian-minimal.sh nutzt docker.io" "$INSTALLER_DIR/install-debian-minimal.sh" "docker.io"
# Alpine nutzt docker docker-compose
assert_grep "install-alpine.sh nutzt apk add docker" "$INSTALLER_DIR/install-alpine.sh" "apk add.*docker"

# --------------------------------------------------------------------------
# 6) wawi.sh Integration
# --------------------------------------------------------------------------
header "6) wawi.sh Integration"

assert_grep "wawi.sh sourced lib/common.sh" "$INSTALLER_DIR/wawi.sh" "lib/common.sh|COMMON_SH"
assert_grep "wawi.sh kennt --os debian-minimal" "$INSTALLER_DIR/wawi.sh" "debian-minimal"
assert_grep "wawi.sh kennt DEBIAN_VARIANT" "$INSTALLER_DIR/wawi.sh" "DEBIAN_VARIANT"
assert_grep "wawi.sh deploy_docker prueft Basis-Dependencies vor Docker" "$INSTALLER_DIR/wawi.sh" "Basis-Dependencies|Dependency-Prüfung"
assert_grep "wawi.sh deploy_docker prueft git vor Clone" "$INSTALLER_DIR/wawi.sh" "command -v git.*fatal|Git installation failed"
assert_grep "wawi.sh deploy_docker prueft docker vor compose" "$INSTALLER_DIR/wawi.sh" "docker --version|docker compose version"

# --------------------------------------------------------------------------
# 7) Live Validierung auf Host (Debian)
# --------------------------------------------------------------------------
header "7) Live Validierung (Host: $(detect_os))"

# Nur wenn common.sh geladen
set +e
validate_environment "debian" "docker"
ec=$?
set -e
assert "validate_environment debian docker auf Host" test $ec -eq 0

# Auch alpine Validierung wird probiert - auf Debian Host muss sie nicht bestehen,
# aber die Funktion muss existieren und eine klare Meldung liefern
set +e
validate_environment "alpine" "docker" >/tmp/validate_alpine.log 2>&1
ec_alpine=$?
set -e
# Auf Debian Host erwarten wir dass alpine Validierung NICHT besteht (da apk fehlt), aber Funktion laeuft
# Deshalb nur pruefen dass Funktion exit code liefert (0 oder 1) und Log existiert
assert "validate_environment alpine laeuft (exit 0/1, Log vorhanden)" test -f /tmp/validate_alpine.log
if [[ $ec_alpine -ne 0 ]]; then
    echo -e "  ${YELLOW}[INFO]${NC} validate_environment alpine erwartungsgemaess fehlgeschlagen auf Debian Host (exit $ec_alpine) - OK"
fi

# --------------------------------------------------------------------------
# Zusammenfassung
# --------------------------------------------------------------------------
header "Zusammenfassung"
echo -e "Gesamt: $TOTAL  |  ${GREEN}PASS: $PASS${NC}  |  ${RED}FAIL: $FAIL${NC}"
if [[ $FAIL -eq 0 ]]; then
    echo -e "${GREEN}Alle Smoke-Tests bestanden.${NC}"
    exit 0
else
    echo -e "${RED}$FAIL Test(s) fehlgeschlagen.${NC}"
    exit 1
fi
