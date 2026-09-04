#!/usr/bin/env bash
# ============================================================================
# WaWi Installer - Debian Minimal / Alternative (schlank, --no-install-recommends)
# Fuer minimale Debian Container / LXC / schlanke Images
# Nutzt distro-Pakete (docker.io) statt offiziellem Docker-Repo
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
COMMON_SH="${SCRIPT_DIR}/lib/common.sh"
if [[ -f "$COMMON_SH" ]]; then
    # shellcheck source=/dev/null
    source "$COMMON_SH"
else
    echo "[i] lib/common.sh nicht gefunden - lade Fallback..."
    if command -v curl &>/dev/null; then
        curl -fsSL "https://raw.githubusercontent.com/puchadave/wawi/master/wawi-installer/lib/common.sh" -o /tmp/wawi-common.sh 2>/dev/null && source /tmp/wawi-common.sh || {
            echo "[✗] common.sh konnte nicht geladen werden"; exit 1; }
    else
        echo "[✗] curl fehlt und lib/common.sh nicht vorhanden - Abbruch"; exit 1
    fi
fi

# --------------------------------------------------------------------------
# Konfiguration
# --------------------------------------------------------------------------
REPO_URL="${REPO_URL:-https://github.com/puchadave/wawi.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/wawi}"
DEPLOY_MODE="${DEPLOY_MODE:-docker}"
WEB_PORT="${WEB_PORT:-5173}"
API_PORT="${API_PORT:-3000}"

# --------------------------------------------------------------------------
# 1. OS-Check
# --------------------------------------------------------------------------
header "WaWi Debian Minimal Installer (--no-install-recommends)"

detected="$(detect_os)"
if [[ "$detected" != "debian" ]]; then
    warn "Erwartet Debian, erkannt: $detected - fahre dennoch fort (Debian Minimal Pfad)"
fi

if [[ $EUID -ne 0 ]]; then
    warn "Nicht als root - versuche mit sudo..."
    if command -v sudo &>/dev/null; then
        exec sudo bash "$0" "$@"
    else
        fatal "Root-Rechte erforderlich und sudo nicht verfuegbar"
    fi
fi

# --------------------------------------------------------------------------
# 2. VOLLSTAENDIGE DEPENDENCY-PRUEFUNG VOR INSTALLATION (minimal)
# --------------------------------------------------------------------------
header "Dependency-Pruefung (vor Installation) - Minimal"

info "Pruefe git..."
if ! require_command git; then
    warn "git nicht gefunden - installiere minimal..."
    install_git_debian_minimal || true
fi
if ! require_command git; then
    fatal "Git installation failed (debian-minimal)"
fi

info "Pruefe curl..."
if ! require_command curl; then
    warn "curl nicht gefunden - installiere minimal..."
    apt_install_debian_minimal curl || true
fi
if ! require_command curl; then
    fatal "curl installation failed (debian-minimal)"
fi

info "Pruefe ca-certificates..."
if ! dpkg -l ca-certificates 2>/dev/null | grep -q "^ii" && [[ ! -f /etc/ssl/certs/ca-certificates.crt ]]; then
    warn "ca-certificates nicht gefunden - installiere minimal..."
    apt_install_debian_minimal ca-certificates || true
fi
if ! dpkg -l ca-certificates 2>/dev/null | grep -q "^ii" && [[ ! -f /etc/ssl/certs/ca-certificates.crt ]]; then
    fatal "ca-certificates installation failed (debian-minimal)"
fi
log "ca-certificates OK"

info "Pruefe bash..."
if ! require_command bash; then
    warn "bash nicht gefunden - installiere..."
    apt_install_debian_minimal bash || true
fi
if ! require_command bash; then
    fatal "bash installation failed (debian-minimal)"
fi

# Schlanke Basis installieren
info "Installiere/verifiziere minimale Basis-Dependencies..."
install_base_deps_debian_minimal || fatal "Basis-Dependency Installation (minimal) fehlgeschlagen"

# --------------------------------------------------------------------------
# 3. NACH INSTALLATION JEDE DEPENDENCY AKTIV PRUEFEN
# --------------------------------------------------------------------------
header "Aktive Verifikation nach Basis-Installation (Minimal)"

validate_git || fatal "validate_git fehlgeschlagen"
validate_curl || fatal "validate_curl fehlgeschlagen"
validate_ca_certificates || fatal "validate_ca_certificates fehlgeschlagen"
validate_bash || fatal "validate_bash fehlgeschlagen"

for cmd in git curl bash; do
    if ! command -v "$cmd" &>/dev/null; then
        fatal "command -v $cmd fehlgeschlagen nach Installation"
    fi
    log "command -v $cmd -> $(command -v "$cmd")"
done

# --------------------------------------------------------------------------
# 4. DOCKER (distro-Pakete)
# --------------------------------------------------------------------------
if [[ "$DEPLOY_MODE" == "docker" ]]; then
    header "Docker Pruefung & Installation (Debian Minimal - distro Pakete)"
    if ! require_command docker; then
        warn "docker nicht gefunden - installiere docker.io (minimal)..."
        install_docker_debian_minimal || true
    fi
    if ! require_command docker; then
        fatal "Docker installation failed (debian-minimal) - docker weiterhin nicht verfuegbar"
    fi
    if ! docker --version &>/dev/null; then
        fatal "docker --version fehlgeschlagen"
    fi
    # compose: plugin oder standalone
    if ! docker compose version &>/dev/null 2>&1; then
        # versuche plugin nachzuinstallieren, sonst nutze docker-compose standalone
        DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends docker-compose-plugin 2>/dev/null || true
        DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends docker-compose 2>/dev/null || true
    fi
    if ! docker compose version &>/dev/null 2>&1 && ! docker-compose version &>/dev/null 2>&1; then
        fatal "docker compose / docker-compose nicht verfuegbar (debian-minimal)"
    fi
    log "docker --version: $(docker --version)"
    if docker compose version &>/dev/null 2>&1; then
        log "docker compose version: $(docker compose version)"
    else
        log "docker-compose version: $(docker-compose version 2>&1 | head -n1)"
    fi
    validate_docker || fatal "validate_docker fehlgeschlagen"
fi

# --------------------------------------------------------------------------
# 5. REPOSITORY ERST NACH GIT-PRUEFUNG
# --------------------------------------------------------------------------
header "Repository Klonen (nur nach Git-Validierung) - Minimal"

require_command git || install_git_debian_minimal
require_command git || fatal "Git installation failed - Clone abgebrochen"

validate_git || fatal "Git Validierung vor Clone fehlgeschlagen"
safe_git_clone "$REPO_URL" "$INSTALL_DIR"

# --------------------------------------------------------------------------
# 6. DOCKER ERST NACH PRUEFUNG VERWENDEN
# --------------------------------------------------------------------------
if [[ "$DEPLOY_MODE" == "docker" ]]; then
    header "Docker Compose Build & Start (Minimal)"
    ensure_docker_available "debian-minimal" || fatal "Docker nicht verfuegbar fuer Compose"
    if [[ ! -f "$INSTALL_DIR/.env" ]]; then
        if [[ -f "$INSTALL_DIR/.env.example" ]]; then
            cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
            log ".env aus .env.example erstellt"
        else
            cat > "$INSTALL_DIR/.env" <<'ENVEOF'
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
DATABASE_URL=postgresql://wawi:wawi_password@postgres:5432/wawi_db
REDIS_URL=redis://redis:6379
ENVEOF
            log "Minimale .env erstellt"
        fi
    fi
    info "Starte: docker compose up -d --build"
    (cd "$INSTALL_DIR" && WEB_PORT="$WEB_PORT" docker compose up -d --build) || fatal "docker compose up fehlgeschlagen"
    log "Docker Compose gestartet"
else
    header "Nativer Build (Minimal - Node.js)"
    if ! require_command node; then
        info "Installiere Node.js 26 (nodesource, minimal) - erster Versuch via common.sh..."
        install_node_debian_minimal 2>/dev/null || true
    fi
    if ! require_command node; then
        warn "node weiterhin nicht verfuegbar (minimal) - Fallback direkt..."
        apt_install_debian_minimal curl ca-certificates gnupg || true
        curl -fsSL https://deb.nodesource.com/setup_26.x | bash - || fatal "nodesource setup fehlgeschlagen"
        DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nodejs || fatal "nodejs Installation fehlgeschlagen"
        require_command node || fatal "node weiterhin nicht verfuegbar"
    fi
    validate_node || fatal "validate_node fehlgeschlagen"
    (cd "$INSTALL_DIR" && npm ci --ignore-scripts && npm run build --workspaces --if-present) || fatal "Build fehlgeschlagen"
    log "Nativer Build abgeschlossen"
fi

# --------------------------------------------------------------------------
# 7. FINALE VALIDIERUNG
# --------------------------------------------------------------------------
header "Finale Validierung (Debian Minimal)"
validate_environment "debian-minimal" "$DEPLOY_MODE" || fatal "Finale validate_environment fehlgeschlagen"

log "Debian Minimal Installation erfolgreich abgeschlossen"
info "Installationsverzeichnis: $INSTALL_DIR"
if [[ "$DEPLOY_MODE" == "docker" ]]; then
    info "Docker: $(docker --version) | $(docker compose version 2>&1 | head -n1 || docker-compose version 2>&1 | head -n1)"
    sleep 5
    curl -sf "http://127.0.0.1:${API_PORT}/health" && log "Health OK" || warn "Health-Check fehlgeschlagen - Container brauchen evtl. mehr Zeit"
fi
