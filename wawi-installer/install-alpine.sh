#!/usr/bin/env bash
# ============================================================================
# WaWi Installer - Alpine Linux (apk)
# Fuer Alpine 3.19 / 3.20 / 3.21 / edge
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
        echo "[✗] curl fehlt und lib/common.sh nicht vorhanden - versuche wget..."
        if command -v wget &>/dev/null; then
            wget -qO /tmp/wawi-common.sh "https://raw.githubusercontent.com/puchadave/wawi/master/wawi-installer/lib/common.sh" && source /tmp/wawi-common.sh || {
                echo "[✗] common.sh konnte nicht geladen werden"; exit 1; }
        else
            echo "[✗] Weder curl noch wget vorhanden und lib/common.sh fehlt - Abbruch"; exit 1
        fi
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
header "WaWi Alpine Installer (apk)"

detected="$(detect_os)"
if [[ "$detected" != "alpine" ]]; then
    warn "Erwartet Alpine, erkannt: $detected - fahre dennoch fort (Alpine Pfad)"
fi

if [[ $EUID -ne 0 ]]; then
    warn "Nicht als root - versuche mit su/sudo..."
    if command -v sudo &>/dev/null; then
        exec sudo bash "$0" "$@"
    else
        fatal "Root-Rechte erforderlich und sudo/su nicht verfuegbar"
    fi
fi

# --------------------------------------------------------------------------
# 2. VOLLSTAENDIGE DEPENDENCY-PRUEFUNG VOR INSTALLATION (Alpine)
#    Vorgabe:
#      apk update
#      apk add git curl ca-certificates bash
# --------------------------------------------------------------------------
header "Dependency-Pruefung (vor Installation) - Alpine"

info "Pruefe git..."
if ! require_command git; then
    warn "git nicht gefunden - installiere (apk)..."
    install_git_alpine || true
fi
if ! require_command git; then
    fatal "Git installation failed - apk add git fehlgeschlagen"
fi

info "Pruefe curl..."
if ! require_command curl; then
    warn "curl nicht gefunden - installiere (apk)..."
    install_curl_alpine || true
fi
if ! require_command curl; then
    fatal "curl installation failed - apk add curl fehlgeschlagen"
fi

info "Pruefe ca-certificates..."
# Alpine: pruefe Paket + Bundle
if ! apk info 2>/dev/null | grep -q "ca-certificates" && [[ ! -f /etc/ssl/certs/ca-certificates.crt ]] && [[ ! -f /etc/ssl/certs/ca-bundle.crt ]]; then
    warn "ca-certificates nicht gefunden - installiere (apk)..."
    install_ca_certificates_alpine || true
fi
if ! apk info 2>/dev/null | grep -q "ca-certificates" && [[ ! -f /etc/ssl/certs/ca-certificates.crt ]] && [[ ! -f /etc/ssl/certs/ca-bundle.crt ]]; then
    fatal "ca-certificates installation failed (alpine)"
fi
log "ca-certificates OK"

info "Pruefe bash..."
if ! require_command bash; then
    warn "bash nicht gefunden - installiere (apk)..."
    install_bash_alpine || true
fi
if ! require_command bash; then
    fatal "bash installation failed - apk add bash fehlgeschlagen"
fi

# Vollstaendige Basis via apk
info "Installiere/verifiziere vollstaendige Alpine Basis-Dependencies..."
install_base_deps_alpine || fatal "Basis-Dependency Installation (alpine) fehlgeschlagen"

# Zusaetzlich curl ca-certificates explizit updaten (Alpine braucht nach ca-cert update)
update-ca-certificates 2>/dev/null || true

# --------------------------------------------------------------------------
# 3. NACH INSTALLATION JEDE DEPENDENCY AKTIV PRUEFEN
#    Vorgabe:
#      command -v git ; command -v docker ; docker --version ; docker compose version
# --------------------------------------------------------------------------
header "Aktive Verifikation nach Basis-Installation (Alpine)"

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
# Explizite Checks wie gefordert
info "Explizite Checks: git --version / curl --version / bash --version"
git --version || fatal "git --version fehlgeschlagen"
curl --version | head -n1 || fatal "curl --version fehlgeschlagen"
bash --version | head -n1 || fatal "bash --version fehlgeschlagen"

# --------------------------------------------------------------------------
# 4. DOCKER (Alpine: apk add docker docker-compose)
# --------------------------------------------------------------------------
if [[ "$DEPLOY_MODE" == "docker" ]]; then
    header "Docker Pruefung & Installation (Alpine)"
    if ! require_command docker; then
        warn "docker nicht gefunden - installiere (apk add docker docker-compose)..."
        install_docker_alpine || true
    fi
    if ! require_command docker; then
        fatal "Docker installation failed (alpine) - apk add docker fehlgeschlagen"
    fi
    if ! docker --version &>/dev/null; then
        fatal "docker --version fehlgeschlagen (alpine)"
    fi
    if ! docker compose version &>/dev/null 2>&1 && ! docker-compose version &>/dev/null 2>&1; then
        warn "docker compose nicht gefunden - versuche docker-cli-compose..."
        apk_add docker-cli-compose 2>/dev/null || true
        apk_add docker-compose 2>/dev/null || true
    fi
    if ! docker compose version &>/dev/null 2>&1 && ! docker-compose version &>/dev/null 2>&1; then
        fatal "docker compose / docker-compose nicht verfuegbar (alpine)"
    fi
    log "docker --version: $(docker --version)"
    if docker compose version &>/dev/null 2>&1; then
        log "docker compose version: $(docker compose version)"
    else
        log "docker-compose version: $(docker-compose version 2>&1 | head -n1)"
    fi
    # compose version explizit wie in Vorgabe
    docker compose version 2>&1 | head -n1 || docker-compose version 2>&1 | head -n1 || true
    validate_docker || fatal "validate_docker fehlgeschlagen (alpine)"
fi

# --------------------------------------------------------------------------
# 5. REPOSITORY ERST NACH GIT-PRUEFUNG
#    Muster:  require_command git || install_git ; require_command git || fatal "Git installation failed" ; git clone
# --------------------------------------------------------------------------
header "Repository Klonen (nur nach Git-Validierung) - Alpine"

require_command git || install_git_alpine
require_command git || fatal "Git installation failed - Clone abgebrochen"

validate_git || fatal "Git Validierung vor Clone fehlgeschlagen"
safe_git_clone "$REPO_URL" "$INSTALL_DIR"

# --------------------------------------------------------------------------
# 6. DOCKER ERST NACH PRUEFUNG VERWENDEN
# --------------------------------------------------------------------------
if [[ "$DEPLOY_MODE" == "docker" ]]; then
    header "Docker Compose Build & Start (Alpine)"
    ensure_docker_available "alpine" || fatal "Docker nicht verfuegbar fuer Compose (alpine)"
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
    (cd "$INSTALL_DIR" && WEB_PORT="$WEB_PORT" docker compose up -d --build) || fatal "docker compose up fehlgeschlagen (alpine)"
    log "Docker Compose gestartet"
else
    header "Nativer Build (Alpine - Node.js)"
    if ! require_command node; then
        info "Installiere Node.js (Alpine)..."
        # Alpine: nodejs + npm direkt via apk bevorzugt
        apk_add nodejs npm python3 make g++ 2>/dev/null || {
            # Fallback: offizielles Node tarball (musl)
            warn "apk nodejs fehlgeschlagen - versuche offizielles tarball..."
            apk_add curl ca-certificates bash 2>/dev/null || true
            if command -v python3 >/dev/null 2>&1; then
                NODE_VERSION="$(curl -s https://nodejs.org/dist/index.json 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['version'].lstrip('v'))" 2>/dev/null || echo "")"
            else
                NODE_VERSION="$(curl -s https://nodejs.org/dist/index.json 2>/dev/null | grep -oE '"version":"v[0-9.]+' | head -1 | cut -d\" -f4 | tr -d 'v' 2>/dev/null || echo "")"
            fi
            if [[ -z "$NODE_VERSION" ]]; then NODE_VERSION="22.14.0"; fi
            info "Lade Node v${NODE_VERSION} (musl)..."
            curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64-musl.tar.xz" -o /tmp/node.tar.xz || fatal "Node Download fehlgeschlagen"
            tar -xf /tmp/node.tar.xz -C /usr/local --strip-components=1 || fatal "Node Entpacken fehlgeschlagen"
            rm -f /tmp/node.tar.xz
        }
        require_command node || fatal "node weiterhin nicht verfuegbar (alpine)"
    fi
    validate_node || fatal "validate_node fehlgeschlagen"
    (cd "$INSTALL_DIR" && npm ci --ignore-scripts && npm run build --workspaces --if-present) || fatal "Build fehlgeschlagen"
    log "Nativer Build abgeschlossen"
fi

# --------------------------------------------------------------------------
# 7. FINALE VALIDIERUNG
# --------------------------------------------------------------------------
header "Finale Validierung (Alpine)"
validate_environment "alpine" "$DEPLOY_MODE" || fatal "Finale validate_environment fehlgeschlagen (alpine)"

log "Alpine Installation erfolgreich abgeschlossen"
info "Installationsverzeichnis: $INSTALL_DIR"
if [[ "$DEPLOY_MODE" == "docker" ]]; then
    info "Docker: $(docker --version) | $(docker compose version 2>&1 | head -n1 || docker-compose version 2>&1 | head -n1)"
    sleep 5
    curl -sf "http://127.0.0.1:${API_PORT}/health" && log "Health OK" || warn "Health-Check fehlgeschlagen - Container brauchen evtl. mehr Zeit"
fi
