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
    header "Nativer Modus: Postgres/Redis + Node.js + DB + Build (ohne Docker)"
    header "1) Postgres & Redis nativ installieren"
    if ! require_command psql && ! require_command pg_isready; then
        warn "Postgres nicht gefunden - installiere (minimal)..."
        install_postgres_debian_minimal || true
    fi
    if ! require_command psql && ! require_command pg_isready; then
        fatal "Postgres installation failed"
    fi
    if ! require_command redis-cli && ! require_command redis-server; then
        warn "Redis nicht gefunden - installiere (minimal)..."
        install_redis_debian_minimal || true
    fi
    if ! require_command redis-cli && ! require_command redis-server; then
        fatal "Redis installation failed"
    fi
    validate_postgres || warn "Postgres Validierung Warnung"
    validate_redis || warn "Redis Validierung Warnung"
    header "2) DB & User einrichten"
    setup_postgres_db wawi wawi_password wawi_db || warn "setup_postgres_db fehlgeschlagen"
    header "3) Node.js installieren"
    if ! require_command node; then
        info "Installiere Node.js via install_node_debian_minimal..."
        install_node_debian_minimal 2>/dev/null || true
    fi
    if ! require_command node; then
        warn "node weiterhin nicht verfuegbar - Fallback nodesource..."
        apt_install_debian_minimal curl ca-certificates gnupg || true
        curl -fsSL https://deb.nodesource.com/setup_22.x | bash - 2>/dev/null || curl -fsSL https://deb.nodesource.com/setup_20.x | bash - || fatal "nodesource setup fehlgeschlagen"
        DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nodejs || fatal "nodejs Installation fehlgeschlagen"
        require_command node || fatal "node weiterhin nicht verfuegbar"
    fi
    validate_node || fatal "validate_node fehlgeschlagen"
    header "4) stack-root & .env (nativ: localhost)"
    ensure_stack_root "$INSTALL_DIR" || fatal "ensure_stack_root fehlgeschlagen"
    if [[ ! -f "$INSTALL_DIR/.env" ]]; then
        if [[ -f "$INSTALL_DIR/.env.example" ]]; then
            cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
            log ".env aus .env.example erstellt"
        else
            cat > "$INSTALL_DIR/.env" <<'ENVEOF_WAWI'
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
DATABASE_URL=postgresql://wawi:wawi_password@localhost:5432/wawi_db
REDIS_URL=redis://localhost:6379
ENVEOF_WAWI
            log "Minimale .env (nativ) erstellt"
        fi
    fi
    if grep -q "postgres:5432" "$INSTALL_DIR/.env" 2>/dev/null; then
        warn "Fixe DATABASE_URL von postgres auf localhost..."
        sed -i 's/@postgres:/@localhost:/g; s/@postgres\b/@localhost/g; s/\bpostgres\b/localhost/g' "$INSTALL_DIR/.env" 2>/dev/null || true
    fi
    if grep -q "redis:6379" "$INSTALL_DIR/.env" 2>/dev/null && grep -q "://redis" "$INSTALL_DIR/.env" 2>/dev/null; then
        warn "Fixe REDIS_URL von redis auf localhost..."
        sed -i 's/redis:6379/localhost:6379/g; s#//redis#//localhost#g' "$INSTALL_DIR/.env" 2>/dev/null || true
    fi
    header "5) Build & Migration"
    info "npm ci & build..."
    (cd "$INSTALL_DIR" && npm ci --ignore-scripts && npm run build --workspaces --if-present) || fatal "Build fehlgeschlagen"
    log "Nativer Build abgeschlossen"
    info "DB-Migration (drizzle-kit push)..."
    (cd "$INSTALL_DIR" && DATABASE_URL=postgresql://wawi:wawi_password@localhost:5432/wawi_db npx --workspace=@wawi/api drizzle-kit push --config=drizzle.config.cjs 2>&1 || npx drizzle-kit push 2>&1 || npm run db:push --workspace=@wawi/api 2>&1 || echo "[w] Migration fehlgeschlagen") || warn "Migration Warnung"
    log "Migration abgeschlossen/geprueft"
    header "6) Service & nginx (Proxy -> 127.0.0.1:${API_PORT})"
    _node_bin="$(command -v node 2>/dev/null || echo /usr/bin/node)"
    if [[ -f /etc/alpine-release ]] || command -v rc-service &>/dev/null; then
        if command -v rc-update &>/dev/null; then
            cat > /etc/init.d/wawi-api <<'INITEOF_WAWI'
#!/sbin/openrc-run
name="wawi-api"
description="WaWi API Server"
command="__NODE_BIN__"
command_args="__INSTALL_DIR__/apps/api/dist/index.js"
command_background=true
pidfile="/run/wawi-api.pid"
output_log="/var/log/wawi-api.log"
error_log="/var/log/wawi-api.log"
depend() {
    need net
    need postgresql
    need redis
}
INITEOF_WAWI
            sed -i "s#__NODE_BIN__#$_node_bin#g; s#__INSTALL_DIR__#$INSTALL_DIR#g" /etc/init.d/wawi-api
            chmod +x /etc/init.d/wawi-api
            rc-update add wawi-api default 2>/dev/null || true
            rc-service wawi-api restart 2>/dev/null || rc-service wawi-api start 2>/dev/null || true
        fi
    else
        if command -v systemctl &>/dev/null; then
            cat > /etc/systemd/system/wawi-api.service <<'SVCEOF_WAWI'
[Unit]
Description=WaWi API
After=network.target postgresql.service redis-server.service
Wants=postgresql.service redis-server.service
[Service]
Type=simple
User=root
WorkingDirectory=__INSTALL_DIR__/apps/api
ExecStart=__NODE_BIN__ __INSTALL_DIR__/apps/api/dist/index.js
Restart=on-failure
RestartSec=5
EnvironmentFile=__INSTALL_DIR__/.env
[Install]
WantedBy=multi-user.target
SVCEOF_WAWI
            sed -i "s#__NODE_BIN__#$_node_bin#g; s#__INSTALL_DIR__#$INSTALL_DIR#g" /etc/systemd/system/wawi-api.service
            systemctl daemon-reload 2>/dev/null || true
            systemctl enable wawi-api 2>/dev/null || true
            systemctl restart wawi-api 2>/dev/null || systemctl start wawi-api 2>/dev/null || true
        else
            nohup "$_node_bin" "$INSTALL_DIR/apps/api/dist/index.js" > /var/log/wawi-api.log 2>&1 & echo $! > /run/wawi-api.pid
            log "API via nohup gestartet"
        fi
    fi
    if true; then
        if [[ -f /etc/alpine-release ]]; then
            apk add --no-cache nginx 2>/dev/null || true
            mkdir -p /var/www/localhost/htdocs 2>/dev/null || true
            [[ -d "$INSTALL_DIR/apps/web/dist" ]] && cp -r "$INSTALL_DIR/apps/web/dist"/* /var/www/localhost/htdocs/ 2>/dev/null || true
        else
            DEBIAN_FRONTEND=noninteractive apt-get install -y nginx 2>/dev/null || true
            mkdir -p /var/www/html 2>/dev/null || true
            [[ -d "$INSTALL_DIR/apps/web/dist" ]] && cp -r "$INSTALL_DIR/apps/web/dist"/* /var/www/html/ 2>/dev/null || true
        fi
        _nginx_conf=""
        if [[ -d /etc/nginx/http.d ]]; then _nginx_conf=/etc/nginx/http.d/wawi.conf
        elif [[ -d /etc/nginx/conf.d ]]; then _nginx_conf=/etc/nginx/conf.d/wawi.conf
        elif [[ -d /etc/nginx/sites-available ]]; then _nginx_conf=/etc/nginx/sites-available/wawi; mkdir -p /etc/nginx/sites-enabled; ln -sf "$_nginx_conf" /etc/nginx/sites-enabled/wawi 2>/dev/null || true; rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
        fi
        if [[ -n "$_nginx_conf" ]] && [[ "$_nginx_conf" != "/etc/nginx/nginx.conf" ]]; then
            cat > "$_nginx_conf" <<'NGINXEOF_WAWI'
server {
    listen __WEB_PORT__;
    listen [::]:__WEB_PORT__;
    server_name _;
    root /var/www/html;
    index index.html;
    location /api/ { proxy_pass http://127.0.0.1:__API_PORT__; }
    location = /health { proxy_pass http://127.0.0.1:__API_PORT__/health; }
    location / { try_files $uri $uri/ /index.html; }
}
NGINXEOF_WAWI
            sed -i "s/__WEB_PORT__/$WEB_PORT/g; s/__API_PORT__/$API_PORT/g" "$_nginx_conf" 2>/dev/null || true
            nginx -t 2>&1 || true
            if command -v rc-service &>/dev/null; then rc-service nginx restart 2>/dev/null || service nginx restart 2>/dev/null || true
            else systemctl restart nginx 2>/dev/null || service nginx restart 2>/dev/null || true
            fi
        fi
    fi
    log "Web-Server Proxy -> 127.0.0.1:${API_PORT} eingerichtet"
fi

# --------------------------------------------------------------------------
# 7. FINALE VALIDIERUNG
# --------------------------------------------------------------------------
header "Finale Validierung (Debian Minimal)"
validate_environment "debian-minimal" "$DEPLOY_MODE" || fatal "Finale validate_environment fehlgeschlagen"

log "Debian Minimal Installation erfolgreich abgeschlossen"
info "Installationsverzeichnis: $INSTALL_DIR"
if [[ -f "$INSTALL_DIR/stack-root/pucha.dev" ]]; then
    info "Admin-User: puchadev"
    info "Admin-Passwort: $(cat "$INSTALL_DIR/stack-root/pucha.dev" 2>/dev/null | head -c 128)"
    info "Passwort-Datei: $INSTALL_DIR/stack-root/pucha.dev (chmod 600)"
else
    warn "stack-root/pucha.dev nicht gefunden"
fi
if [[ "$DEPLOY_MODE" == "docker" ]]; then
    info "Docker: $(docker --version) | $(docker compose version 2>&1 | head -n1 || docker-compose version 2>&1 | head -n1)"
    sleep 5
    curl -sf "http://127.0.0.1:${API_PORT}/health" && log "Health OK" || warn "Health-Check fehlgeschlagen - Container brauchen evtl. mehr Zeit"
else
    info "Nativ Health: pruefe API, Postgres, Redis..."
    sleep 5
    curl -sf "http://127.0.0.1:${API_PORT}/health" && log "Health OK (nativ)" || warn "Nativ Health-Check fehlgeschlagen - API braucht evtl. mehr Zeit (logs: cat /var/log/wawi-api.log)"
    pg_isready -q 2>/dev/null && log "Postgres OK" || pg_isready -h localhost -q 2>/dev/null && log "Postgres localhost OK" || warn "pg_isready fehlgeschlagen"
    redis-cli ping 2>/dev/null | grep -qi PONG && log "Redis PONG" || redis-cli -h localhost ping 2>/dev/null | grep -qi PONG && log "Redis localhost PONG" || warn "redis-cli ping fehlgeschlagen"
fi
info "Zugang: http://$(hostname -I 2>/dev/null | awk '{print $1}'):${WEB_PORT}/login  API http://$(hostname -I 2>/dev/null | awk '{print $1}'):${API_PORT}/health  User=puchadev  PW=\$(cat "$INSTALL_DIR/stack-root/pucha.dev" 2>/dev/null | head -c 64)"
