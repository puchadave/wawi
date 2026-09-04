#!/usr/bin/env bash
# ============================================================================
# WaWi Installer - Debian Standard (vollstaendig, offizielles Docker-Repo)
# Fuer Debian 12 (bookworm) / Debian 13 / Ubuntu 22.04/24.04
# Kann direkt im Zielsystem ausgefuehrt werden oder via wawi.sh pct exec
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
COMMON_SH="${SCRIPT_DIR}/lib/common.sh"
if [[ -f "$COMMON_SH" ]]; then
    # shellcheck source=/dev/null
    source "$COMMON_SH"
else
    # Fallback wenn via curl-pipe ohne lib/ aufgerufen
    echo "[i] lib/common.sh nicht gefunden - lade Fallback..."
    if command -v curl &>/dev/null; then
        # Versuche common.sh aus Repo zu laden (raw github)
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
DEPLOY_MODE="${DEPLOY_MODE:-docker}"   # docker | nativ
WEB_PORT="${WEB_PORT:-5173}"
API_PORT="${API_PORT:-3000}"
OS_EXPECTED="debian"

# --------------------------------------------------------------------------
# 1. OS-Check
# --------------------------------------------------------------------------
header "WaWi Debian Standard Installer"

detected="$(detect_os)"
if [[ "$detected" != "debian" ]]; then
    warn "Erwartet Debian, erkannt: $detected - fahre dennoch fort (Debian Standard Pfad)"
fi

if [[ $EUID -ne 0 ]]; then
    warn "Nicht als root - versuche mit sudo..."
    if command -v sudo &>/dev/null; then
        exec sudo bash "$0" "$@"
    else
        fatal "Root-Rechte erforderlich (EUID != 0) und sudo nicht verfuegbar"
    fi
fi

# --------------------------------------------------------------------------
# 2. VOLLSTAENDIGE DEPENDENCY-PRUEFUNG VOR INSTALLATION
# --------------------------------------------------------------------------
header "Dependency-Pruefung (vor Installation)"

# Helfer: versucht Installation wenn Befehl fehlt, prueft erneut, bricht bei Fehlschlag ab
# Muster aus Vorgabe:  require_command git || install_git ; require_command git || fatal "Git installation failed"

info "Pruefe git (vor Installation)..."
if ! require_command git; then
    warn "git nicht gefunden - installiere (Debian Standard)..."
    install_git_debian || true
fi
if ! require_command git; then
    fatal "Git installation failed - apt-get install git fehlgeschlagen"
fi
info "git gefunden: $(git --version)"

info "Pruefe curl..."
if ! require_command curl; then
    warn "curl nicht gefunden - installiere..."
    install_curl_debian || true
fi
if ! require_command curl; then
    fatal "curl installation failed"
fi

info "Pruefe ca-certificates..."
# ca-certificates ist kein Binary, pruefe via dpkg + Datei
if ! dpkg -l ca-certificates 2>/dev/null | grep -q "^ii" && [[ ! -f /etc/ssl/certs/ca-certificates.crt ]]; then
    warn "ca-certificates nicht gefunden - installiere..."
    install_ca_certificates_debian || true
fi
if ! dpkg -l ca-certificates 2>/dev/null | grep -q "^ii" && [[ ! -f /etc/ssl/certs/ca-certificates.crt ]]; then
    fatal "ca-certificates installation failed"
fi
log "ca-certificates OK"

info "Pruefe bash..."
if ! require_command bash; then
    warn "bash nicht gefunden - installiere..."
    install_bash_debian || true
fi
if ! require_command bash; then
    fatal "bash installation failed"
fi

# Basis-Dependencies vollstaendig installieren (stellt sicher dass alle drei plus gnupg vorhanden)
# Diese Zeile ist idempotent - falls schon installiert, macht apt nichts
info "Installiere/verifiziere vollstaendige Debian Standard Basis-Dependencies..."
install_base_deps_debian || fatal "Basis-Dependency Installation fehlgeschlagen"

# --------------------------------------------------------------------------
# 3. NACH DER INSTALLATION JEDE DEPENDENCY AKTIV PRUEFEN
# --------------------------------------------------------------------------
header "Aktive Verifikation nach Basis-Installation"

validate_git || fatal "validate_git fehlgeschlagen"
validate_curl || fatal "validate_curl fehlgeschlagen"
validate_ca_certificates || fatal "validate_ca_certificates fehlgeschlagen"
validate_bash || fatal "validate_bash fehlgeschlagen"

# command -v Checks explizit wie gefordert
for cmd in git curl bash; do
    if ! command -v "$cmd" &>/dev/null; then
        fatal "command -v $cmd fehlgeschlagen nach Installation"
    fi
    log "command -v $cmd -> $(command -v "$cmd")"
done

# --------------------------------------------------------------------------
# 4. DOCKER (nur wenn DEPLOY_MODE=docker) - DARF ERST NACH PRUEFUNG VERWENDET WERDEN
# --------------------------------------------------------------------------
if [[ "$DEPLOY_MODE" == "docker" ]]; then
    header "Docker Pruefung & Installation (Debian Standard)"
    if ! require_command docker; then
        warn "docker nicht gefunden - installiere (offizielles Docker-Repo)..."
        install_docker_debian_standard || true
    fi
    if ! require_command docker; then
        fatal "Docker installation failed - docker weiterhin nicht verfuegbar"
    fi
    # docker compose Plugin pruefen
    if ! docker compose version &>/dev/null 2>&1; then
        warn "docker compose Plugin nicht gefunden - versuche Installation..."
        # wurde bereits mit docker-ce installiert, falls dennoch fehlt: neu versuchen
        DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose-plugin 2>/dev/null || true
    fi
    if ! docker --version &>/dev/null; then
        fatal "docker --version fehlgeschlagen"
    fi
    if ! docker compose version &>/dev/null 2>&1 && ! docker-compose version &>/dev/null 2>&1; then
        fatal "docker compose / docker-compose nicht verfuegbar"
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
# 5. REPOSITORY ERST NACH ERFOLGREICHER GIT-PRUEFUNG KLONEN
#    Muster:  require_command git || install_git ; require_command git || fatal "Git installation failed" ; git clone
# --------------------------------------------------------------------------
header "Repository Klonen (nur nach Git-Validierung)"

# Nochmals explizit wie im Beispiel gefordert:
require_command git || install_git_debian
require_command git || fatal "Git installation failed - Clone abgebrochen"

validate_git || fatal "Git Validierung vor Clone fehlgeschlagen"
info "Git OK - klone Repository..."
safe_git_clone "$REPO_URL" "$INSTALL_DIR"

# --------------------------------------------------------------------------
# 6. DOCKER DARF ERST NACH ERFOLGREICHER PRUEFUNG VERWENDET WERDEN
# --------------------------------------------------------------------------
if [[ "$DEPLOY_MODE" == "docker" ]]; then
    header "Docker Compose Build & Start (nur nach Docker-Validierung)"
    ensure_docker_available "debian" || fatal "Docker nicht verfuegbar fuer Compose"
    # .env erzeugen falls nicht vorhanden (minimal)
    if [[ ! -f "$INSTALL_DIR/.env" ]]; then
        if [[ -f "$INSTALL_DIR/.env.example" ]]; then
            cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
            log ".env aus .env.example erstellt"
        else
            warn ".env.example nicht gefunden - erstelle minimale .env"
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
    header "Nativer Build (Node.js)"
    if ! require_command node; then
        info "Installiere Node.js 26 (nodesource) - erster Versuch via common.sh..."
        install_node_debian 2>/dev/null || true
    fi
    if ! require_command node; then
        warn "node weiterhin nicht verfuegbar - versuche Fallback direkt..."
        apt_install_debian curl ca-certificates gnupg || true
        curl -fsSL https://deb.nodesource.com/setup_26.x | bash - || fatal "nodesource setup fehlgeschlagen"
        DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs || fatal "nodejs Installation fehlgeschlagen"
        require_command node || fatal "node weiterhin nicht verfuegbar"
    fi
    validate_node || fatal "validate_node fehlgeschlagen"
    info "npm ci & build..."
    (cd "$INSTALL_DIR" && npm ci --ignore-scripts && npm run build --workspaces --if-present) || fatal "Build fehlgeschlagen"
    log "Nativer Build abgeschlossen"
fi

# --------------------------------------------------------------------------
# 7. FINALE VALIDIERUNG
# --------------------------------------------------------------------------
header "Finale Validierung"
validate_environment "debian" "$DEPLOY_MODE" || fatal "Finale validate_environment fehlgeschlagen"

log "Debian Standard Installation erfolgreich abgeschlossen"
info "Installationsverzeichnis: $INSTALL_DIR"
if [[ "$DEPLOY_MODE" == "docker" ]]; then
    info "Docker: $(docker --version) | $(docker compose version 2>&1 | head -n1)"
    info "Starte Health-Check: curl http://127.0.0.1:${API_PORT}/health (in 10s)..."
    sleep 10
    curl -sf "http://127.0.0.1:${API_PORT}/health" && log "Health OK" || warn "Health-Check fehlgeschlagen - Container brauchen evtl. mehr Zeit"
fi
