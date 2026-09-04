#!/usr/bin/env bash
# ============================================================================
# WaWi Installer - Gemeinsame Bibliothek (lib/common.sh)
# Zentrale Funktionen fuer alle Installationspfade
# OS-spezifische Paketinstallation sauber getrennt
# ============================================================================
# shellcheck disable=SC2034

# --------------------------------------------------------------------------
# Farben & Logging (idempotent)
# --------------------------------------------------------------------------
if [[ -z "${COMMON_SH_LOADED:-}" ]]; then
COMMON_SH_LOADED=1

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()    { echo -e "${GREEN}[✓]${NC} $*"; }
warn()   { echo -e "${YELLOW}[!]${NC} $*"; }
err()    { echo -e "${RED}[✗]${NC} $*"; }
info()   { echo -e "${BLUE}[i]${NC} $*"; }
header() { echo -e "\n${BOLD}${CYAN}━━━ $* ━━━${NC}\n"; }

fatal() {
    err "$*"
    echo -e "${RED}Abbruch.${NC}" >&2
    exit 1
}

# --------------------------------------------------------------------------
# OS-Erkennung
# --------------------------------------------------------------------------
detect_os() {
    if [[ -f /etc/alpine-release ]]; then
        echo "alpine"
    elif [[ -f /etc/debian_version ]] || grep -qi "debian\|ubuntu" /etc/os-release 2>/dev/null; then
        echo "debian"
    elif command -v apk &>/dev/null; then
        echo "alpine"
    elif command -v apt-get &>/dev/null; then
        echo "debian"
    else
        echo "unknown"
    fi
}

# --------------------------------------------------------------------------
# Basis-Pruefungen
# --------------------------------------------------------------------------
require_command() {
    local cmd="$1"
    command -v "$cmd" &>/dev/null
}

require_command_or_install() {
    local cmd="$1"
    local installer_fn="$2"
    if require_command "$cmd"; then
        return 0
    fi
    warn "Befehl '$cmd' nicht gefunden - versuche Installation via $installer_fn ..."
    if ! "$installer_fn"; then
        err "Installation von '$cmd' fehlgeschlagen (Installer $installer_fn lieferte Fehler)"
        return 1
    fi
    if require_command "$cmd"; then
        log "'$cmd' nach Installation verfuegbar: $(command -v "$cmd")"
        return 0
    fi
    err "'$cmd' nach Installationsversuch weiterhin nicht verfuegbar"
    return 1
}

# Variante exakt nach Vorgabe:  require_command git || install_git ; require_command git || fatal "..."
# Wrapper fuer lesbarkeit:
ensure_command() {
    local cmd="$1"
    local installer_fn="$2"
    local label="${3:-$cmd}"
    if ! require_command "$cmd"; then
        warn "$label nicht gefunden - installiere..."
        "$installer_fn" || true
    fi
    if ! require_command "$cmd"; then
        fatal "$label installation failed - '$cmd' weiterhin nicht verfuegbar (command -v $cmd fehlgeschlagen)"
    fi
    # Aktive Versionspruefung
    case "$cmd" in
        git)    git --version &>/dev/null || fatal "git --version fehlgeschlagen" ;;
        curl)   curl --version &>/dev/null || fatal "curl --version fehlgeschlagen" ;;
        bash)   bash --version &>/dev/null || fatal "bash --version fehlgeschlagen" ;;
        docker) docker --version &>/dev/null || fatal "docker --version fehlgeschlagen" ;;
    esac
    log "$label OK: $(command -v "$cmd")"
}

# --------------------------------------------------------------------------
# Debian Paket-Helpers
# --------------------------------------------------------------------------
apt_update() {
    info "apt-get update..."
    if ! apt-get update -qq; then
        warn "apt-get update -qq fehlgeschlagen, versuche ohne -qq..."
        apt-get update || return 1
    fi
}

apt_install_debian() {
    # $* = paketliste
    apt_update || return 1
    info "apt-get install -y $*"
    DEBIAN_FRONTEND=noninteractive apt-get install -y "$@" || return 1
}

apt_install_debian_minimal() {
    apt_update || return 1
    info "apt-get install -y --no-install-recommends $*"
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@" || return 1
}

# Einzelne Installer Debian
install_git_debian() {
    apt_install_debian git || return 1
}
install_git_debian_minimal() {
    apt_install_debian_minimal git || return 1
}
install_curl_debian() {
    apt_install_debian curl || return 1
}
install_ca_certificates_debian() {
    apt_install_debian ca-certificates || return 1
}
install_bash_debian() {
    apt_install_debian bash || return 1
}
install_gnupg_debian() {
    apt_install_debian gnupg ca-certificates curl || return 1
}

# Docker Debian Standard: offizielles Docker-Repo
install_docker_debian_standard() {
    info "Installiere Docker (Debian Standard - offizielles Repo)..."
    apt_install_debian ca-certificates curl gnupg || return 1
    install -m 0755 -d /etc/apt/keyrings || return 1
    if ! curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg; then
        err "Docker GPG Key Download fehlgeschlagen"
        return 1
    fi
    chmod a+r /etc/apt/keyrings/docker.gpg
    local arch codename
    arch="$(dpkg --print-architecture)"
    codename="$(. /etc/os-release && echo "$VERSION_CODENAME")"
    echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian ${codename} stable" > /etc/apt/sources.list.d/docker.list
    apt_update || return 1
    DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin || return 1
    if command -v systemctl &>/dev/null; then
        systemctl enable docker 2>/dev/null || true
        systemctl start docker 2>/dev/null || true
    fi
    # Fallback: dockerd starten falls systemctl nicht verfuegbar (LXC)
    if ! docker info &>/dev/null 2>&1; then
        warn "Docker daemon nicht erreichbar - versuche dockerd im Hintergrund zu starten..."
        dockerd &>/dev/null &
        sleep 3
    fi
}

# Docker Debian Minimal: distro-Pakete (docker.io)
install_docker_debian_minimal() {
    info "Installiere Docker (Debian Minimal - distro Pakete)..."
    apt_install_debian_minimal docker.io docker-compose ca-certificates curl || return 1
    # docker-compose-plugin falls verfuegbar zusaetzlich
    apt_install_debian_minimal docker-compose-plugin 2>/dev/null || true
    if command -v systemctl &>/dev/null; then
        systemctl enable docker 2>/dev/null || true
        systemctl start docker 2>/dev/null || true
    fi
    if ! docker info &>/dev/null 2>&1; then
        dockerd >/dev/null 2>&1 &
        sleep 3
    fi
}

# --------------------------------------------------------------------------
# Alpine Paket-Helpers
# --------------------------------------------------------------------------
apk_update() {
    info "apk update..."
    apk update || return 1
}

apk_add() {
    apk_update || return 1
    info "apk add --no-cache $*"
    apk add --no-cache "$@" || return 1
}

install_git_alpine() { apk_add git || return 1; }
install_curl_alpine() { apk_add curl || return 1; }
install_ca_certificates_alpine() { apk_add ca-certificates || return 1; }
install_bash_alpine() { apk_add bash || return 1; }

install_docker_alpine() {
    info "Installiere Docker (Alpine)..."
    apk_add docker docker-compose ca-certificates curl bash || return 1
    # docker-compose-plugin ist bei Alpine im Paket docker-compose enthalten;
    # zusaetzlich docker-cli-compose falls verfuegbar
    apk_add docker-cli-compose 2>/dev/null || true
    if command -v rc-update &>/dev/null; then
        rc-update add docker boot 2>/dev/null || true
        service docker start 2>/dev/null || true
    fi
    if ! docker info &>/dev/null 2>&1; then
        dockerd >/dev/null 2>&1 &
        sleep 3
    fi
}

install_node_debian() {
    info "Installiere Node.js 26 (Debian, nodesource)..."
    apt_install_debian curl ca-certificates gnupg || return 1
    if ! curl -fsSL https://deb.nodesource.com/setup_26.x | bash -; then
        err "nodesource setup fehlgeschlagen"
        return 1
    fi
    DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs || return 1
}

install_node_debian_minimal() {
    info "Installiere Node.js 26 (Debian Minimal, nodesource)..."
    apt_install_debian_minimal curl ca-certificates gnupg || return 1
    if ! curl -fsSL https://deb.nodesource.com/setup_26.x | bash -; then
        err "nodesource setup fehlgeschlagen"
        return 1
    fi
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nodejs || return 1
}

install_node_alpine() {
    info "Installiere Node.js (Alpine, apk)..."
    if apk_add nodejs npm 2>/dev/null; then
        apk_add python3 make g++ 2>/dev/null || true
        return 0
    fi
    warn "apk nodejs fehlgeschlagen - versuche offizielles musl Tarball..."
    apk_add curl ca-certificates bash python3 make g++ || return 1
    local node_ver
    node_ver="$(curl -s https://nodejs.org/dist/index.json | grep -o '"version":"v[^"]*"' | head -1 | cut -d'"' -f4 | tr -d 'v')"
    [[ -z "$node_ver" ]] && node_ver="22.14.0"
    info "Lade Node v${node_ver} (musl)..."
    if ! curl -fsSL "https://nodejs.org/dist/v${node_ver}/node-v${node_ver}-linux-x64-musl.tar.xz" -o /tmp/node.tar.xz; then
        err "Node Download fehlgeschlagen"; return 1
    fi
    if ! tar -xf /tmp/node.tar.xz -C /usr/local --strip-components=1; then
        err "Node Entpacken fehlgeschlagen"; return 1
    fi
    rm -f /tmp/node.tar.xz
}

# --------------------------------------------------------------------------
# Postgres / Redis - OS-spezifische Installer (fuer NATIV-Modus)
# Repliziert was docker-compose.yml via Container liefert, direkt auf Host
# --------------------------------------------------------------------------
install_postgres_debian() {
    info "Installiere PostgreSQL (Debian Standard)..."
    apt_install_debian postgresql postgresql-contrib || return 1
    if command -v systemctl &>/dev/null; then
        systemctl enable postgresql 2>/dev/null || true
        systemctl start postgresql 2>/dev/null || service postgresql start 2>/dev/null || true
    else
        service postgresql start 2>/dev/null || pg_ctlcluster 16 main start 2>/dev/null || true
    fi
    sleep 2
}

install_postgres_debian_minimal() {
    info "Installiere PostgreSQL (Debian Minimal, --no-install-recommends)..."
    apt_install_debian_minimal postgresql postgresql-contrib || return 1
    if command -v systemctl &>/dev/null; then
        systemctl enable postgresql 2>/dev/null || true
        systemctl start postgresql 2>/dev/null || service postgresql start 2>/dev/null || true
    else
        service postgresql start 2>/dev/null || pg_ctlcluster 16 main start 2>/dev/null || true
    fi
    sleep 2
}

install_postgres_alpine() {
    info "Installiere PostgreSQL (Alpine)..."
    apk_add postgresql16 postgresql16-client postgresql16-contrib 2>/dev/null || apk_add postgresql postgresql-client 2>/dev/null || return 1
    if ! id postgres &>/dev/null; then warn "postgres user nicht gefunden nach Installation"; fi
    mkdir -p /var/lib/postgresql/data /run/postgresql
    chown -R postgres:postgres /var/lib/postgresql 2>/dev/null || true
    chown -R postgres:postgres /run/postgresql 2>/dev/null || true
    if [[ ! -s /var/lib/postgresql/data/PG_VERSION ]]; then
        info "Initialisiere PostgreSQL Cluster (initdb)..."
        su postgres -c "initdb -D /var/lib/postgresql/data --auth=trust" 2>/dev/null || su postgres -c "initdb -D /var/lib/postgresql/data" 2>/dev/null || initdb -D /var/lib/postgresql/data -U postgres 2>/dev/null || true
    fi
    if command -v rc-update &>/dev/null; then
        rc-update add postgresql default 2>/dev/null || true
        service postgresql start 2>/dev/null || rc-service postgresql start 2>/dev/null || true
    fi
    if ! pg_isready -q 2>/dev/null; then
        warn "pg_isready fehlgeschlagen - versuche postgres manuell zu starten..."
        su postgres -c "pg_ctl -D /var/lib/postgresql/data -l /var/log/postgresql.log start" 2>/dev/null || pg_ctl -D /var/lib/postgresql/data -l /tmp/pg.log start 2>/dev/null || true
        sleep 2
    fi
}

install_redis_debian() {
    info "Installiere Redis (Debian Standard)..."
    apt_install_debian redis-server || apt_install_debian redis || return 1
    if command -v systemctl &>/dev/null; then
        systemctl enable redis-server 2>/dev/null || systemctl enable redis 2>/dev/null || true
        systemctl start redis-server 2>/dev/null || systemctl start redis 2>/dev/null || service redis-server start 2>/dev/null || true
    else
        service redis-server start 2>/dev/null || service redis start 2>/dev/null || redis-server --daemonize yes 2>/dev/null || true
    fi
}

install_redis_debian_minimal() {
    info "Installiere Redis (Debian Minimal)..."
    apt_install_debian_minimal redis-server 2>/dev/null || apt_install_debian_minimal redis 2>/dev/null || return 1
    if command -v systemctl &>/dev/null; then
        systemctl enable redis-server 2>/dev/null || systemctl enable redis 2>/dev/null || true
        systemctl start redis-server 2>/dev/null || systemctl start redis 2>/dev/null || service redis-server start 2>/dev/null || true
    else
        service redis-server start 2>/dev/null || redis-server --daemonize yes 2>/dev/null || true
    fi
}

install_redis_alpine() {
    info "Installiere Redis (Alpine)..."
    apk_add redis || return 1
    if command -v rc-update &>/dev/null; then
        rc-update add redis default 2>/dev/null || true
        service redis start 2>/dev/null || rc-service redis start 2>/dev/null || true
    fi
    if ! redis-cli ping &>/dev/null 2>&1; then
        redis-server --daemonize yes 2>/dev/null || true
    fi
}

setup_postgres_db() {
    local db_user="${1:-wawi}"
    local db_pass="${2:-wawi_password}"
    local db_name="${3:-wawi_db}"
    info "Richte PostgreSQL DB ein: user=$db_user db=$db_name ..."
    if ! pg_isready -q 2>/dev/null && ! pg_isready -h localhost -q 2>/dev/null; then
        warn "Postgres nicht ready - warte 3s..."
        sleep 3
    fi
    if su postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='$db_user'\"" 2>/dev/null | grep -q 1; then
        log "DB-User $db_user existiert bereits"
    else
        su postgres -c "psql -c \"CREATE USER $db_user WITH PASSWORD '$db_pass' CREATEDB;\"" 2>/dev/null || su postgres -c "psql -c \"CREATE USER $db_user WITH PASSWORD '$db_pass';\"" 2>/dev/null || sudo -u postgres psql -c "CREATE USER $db_user WITH PASSWORD '$db_pass';" 2>/dev/null || true
        log "DB-User $db_user erstellt"
    fi
    if su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='$db_name'\"" 2>/dev/null | grep -q 1; then
        log "DB $db_name existiert bereits"
    else
        su postgres -c "createdb -O $db_user $db_name" 2>/dev/null || su postgres -c "psql -c \"CREATE DATABASE $db_name OWNER $db_user;\"" 2>/dev/null || sudo -u postgres createdb -O "$db_user" "$db_name" 2>/dev/null || true
        log "DB $db_name erstellt"
    fi
    su postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE $db_name TO $db_user;\"" 2>/dev/null || true
}

install_postgres() {
    local os; os="$(detect_os)"
    case "$os" in
        debian) install_postgres_debian ;;
        alpine) install_postgres_alpine ;;
        *) fatal "Unbekanntes OS fuer postgres-Installation: $os" ;;
    esac
}

install_redis() {
    local os; os="$(detect_os)"
    case "$os" in
        debian) install_redis_debian ;;
        alpine) install_redis_alpine ;;
        *) fatal "Unbekanntes OS fuer redis-Installation: $os" ;;
    esac
}

# --------------------------------------------------------------------------
# stack-root / Admin-Passwort (ersetzt docker-stack Persistenz)
# Muss direkt auf Host funktionieren - unabhaengig vom Modus
# --------------------------------------------------------------------------
ensure_stack_root() {
    local install_dir="${1:-${INSTALL_DIR:-/opt/wawi}}"
    local stack_root="$install_dir/stack-root"
    local pw_file="$stack_root/pucha.dev"
    if [[ ! -d "$stack_root" ]]; then
        mkdir -p "$stack_root"
        chmod 700 "$stack_root" 2>/dev/null || true
        log "stack-root erstellt: $stack_root"
    fi
    if [[ -f "$pw_file" ]] && [[ -s "$pw_file" ]]; then
        log "Admin-Passwort existiert bereits: $pw_file"
        return 0
    fi
    local pw
    if command -v openssl &>/dev/null; then
        pw="$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 32)"
    else
        pw="$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)"
    fi
    [[ -z "$pw" ]] && pw="WaWi-$(date +%s)-$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    echo -n "$pw" > "$pw_file"
    chmod 600 "$pw_file" 2>/dev/null || true
    log "Admin-Passwort generiert: $pw_file (User: puchadev)"
}

# --------------------------------------------------------------------------
# Dispatcher: OS-unabhaengige Installer
# --------------------------------------------------------------------------
install_git() {
    local os
    os="$(detect_os)"
    case "$os" in
        debian) install_git_debian ;;
        alpine) install_git_alpine ;;
        *) fatal "Unbekanntes OS fuer git-Installation: $os" ;;
    esac
}
install_curl() {
    local os; os="$(detect_os)"
    case "$os" in
        debian) install_curl_debian ;;
        alpine) install_curl_alpine ;;
        *) fatal "Unbekanntes OS fuer curl-Installation: $os" ;;
    esac
}
install_ca_certificates() {
    local os; os="$(detect_os)"
    case "$os" in
        debian) install_ca_certificates_debian ;;
        alpine) install_ca_certificates_alpine ;;
        *) fatal "Unbekanntes OS fuer ca-certificates-Installation: $os" ;;
    esac
}
install_bash_pkg() {
    local os; os="$(detect_os)"
    case "$os" in
        debian) install_bash_debian ;;
        alpine) install_bash_alpine ;;
        *) fatal "Unbekanntes OS fuer bash-Installation: $os" ;;
    esac
}

install_base_deps_debian() {
    info "Installiere Basis-Dependencies (Debian Standard)..."
    apt_install_debian git curl ca-certificates bash gnupg || return 1
}

install_base_deps_debian_minimal() {
    info "Installiere Basis-Dependencies (Debian Minimal)..."
    apt_install_debian_minimal git curl ca-certificates bash || return 1
}

install_base_deps_alpine() {
    info "Installiere Basis-Dependencies (Alpine)..."
    apk_add git curl ca-certificates bash || return 1
}

# --------------------------------------------------------------------------
# Validierung
# --------------------------------------------------------------------------
validate_command() {
    local cmd="$1"
    local label="${2:-$cmd}"
    if ! command -v "$cmd" &>/dev/null; then
        err "VALIDATE FAIL: $label ('$cmd' nicht gefunden via command -v)"
        return 1
    fi
    log "VALIDATE OK: $label -> $(command -v "$cmd")"
    return 0
}

validate_git() {
    validate_command git "git" || return 1
    git --version 2>&1 | head -n1 | grep -q "git version" || { err "git --version unerwartete Ausgabe"; return 1; }
    log "git --version: $(git --version 2>&1 | head -n1)"
}

validate_curl() {
    validate_command curl "curl" || return 1
    curl --version 2>&1 | head -n1 | grep -q "curl" || { err "curl --version unerwartete Ausgabe"; return 1; }
    log "curl --version: $(curl --version 2>&1 | head -n1)"
}

validate_bash() {
    validate_command bash "bash" || return 1
    bash --version 2>&1 | head -n1 | grep -q "bash" || { err "bash --version unerwartete Ausgabe"; return 1; }
    log "bash --version: $(bash --version 2>&1 | head -n1)"
}

validate_ca_certificates() {
    # ca-certificates ist kein Befehl, pruefe Datei und Paket
    if [[ -f /etc/ssl/certs/ca-certificates.crt ]] || [[ -f /etc/ssl/certs/ca-bundle.crt ]]; then
        log "ca-certificates OK: Zertifikatsbundle vorhanden"
        return 0
    fi
    local os; os="$(detect_os)"
    if [[ "$os" == "debian" ]]; then
        if dpkg -l ca-certificates 2>/dev/null | grep -q "^ii"; then
            log "ca-certificates OK: Paket installiert"
            return 0
        fi
    elif [[ "$os" == "alpine" ]]; then
        if apk info 2>/dev/null | grep -q "ca-certificates"; then
            log "ca-certificates OK: Paket installiert"
            return 0
        fi
    fi
    err "VALIDATE FAIL: ca-certificates nicht gefunden (kein Bundle, kein Paket)"
    return 1
}

validate_docker() {
    validate_command docker "docker" || return 1
    if ! docker --version &>/dev/null; then
        err "docker --version fehlgeschlagen"
        return 1
    fi
    log "docker --version: $(docker --version 2>&1 | head -n1)"
    # docker compose: plugin bevorzugt, fallback standalone
    if docker compose version &>/dev/null 2>&1; then
        log "docker compose version: $(docker compose version 2>&1 | head -n1)"
    elif command -v docker-compose &>/dev/null && docker-compose version &>/dev/null; then
        log "docker-compose version: $(docker-compose version 2>&1 | head -n1)"
    else
        err "VALIDATE FAIL: weder 'docker compose' (Plugin) noch 'docker-compose' verfuegbar"
        return 1
    fi
    return 0
}

validate_node() {
    validate_command node "node" || return 1
    log "node --version: $(node --version 2>&1 | head -n1)"
    validate_command npm "npm" || return 1
    log "npm --version: $(npm --version 2>&1 | head -n1)"
}

validate_postgres() {
    if command -v psql &>/dev/null; then
        log "psql OK: $(psql --version 2>&1 | head -n1)"
    elif command -v pg_isready &>/dev/null; then
        log "pg_isready OK: $(pg_isready --version 2>&1 | head -n1)"
    else
        err "VALIDATE FAIL: weder psql noch pg_isready gefunden"
        return 1
    fi
    if pg_isready -q 2>/dev/null || pg_isready -h localhost -q 2>/dev/null || pg_isready -h 127.0.0.1 -q 2>/dev/null; then
        log "Postgres erreichbar (pg_isready OK)"
    else
        warn "Postgres installiert aber nicht erreichbar (pg_isready fehlgeschlagen) - evtl. noch am Starten"
    fi
    return 0
}

validate_redis() {
    if command -v redis-cli &>/dev/null; then
        log "redis-cli OK: $(redis-cli --version 2>&1 | head -n1)"
    elif command -v redis-server &>/dev/null; then
        log "redis-server OK: $(redis-server --version 2>&1 | head -n1)"
    else
        err "VALIDATE FAIL: weder redis-cli noch redis-server gefunden"
        return 1
    fi
    if redis-cli ping 2>/dev/null | grep -qi PONG || redis-cli -h localhost ping 2>/dev/null | grep -qi PONG; then
        log "Redis erreichbar (PING -> PONG)"
    else
        warn "Redis installiert aber nicht erreichbar (redis-cli ping fehlgeschlagen) - evtl. noch am Starten"
    fi
    return 0
}

# Haupt-Validierungsroutine (wie gefordert: validate_environment)
# Aufruf: validate_environment [debian|debian-minimal|alpine] [docker|nativ]
# Ohne Argumente: auto-detect OS, mode=docker
validate_environment() {
    local os_type="${1:-$(detect_os)}"
    local mode="${2:-docker}"
    local failed=0

    header "Validiere Environment (OS=$os_type MODE=$mode)"

    # Normalisiere debian-minimal -> debian fuer OS-Check, aber logge Unterschied
    local os_check="$os_type"
    [[ "$os_check" == "debian-minimal" ]] && os_check="debian"

    #immer erforderlich
    validate_git || failed=1
    validate_curl || failed=1
    validate_ca_certificates || failed=1
    validate_bash || failed=1

    if [[ "$mode" == "docker" ]]; then
        validate_docker || failed=1
    elif [[ "$mode" == "nativ" ]]; then
        validate_node || failed=1
        validate_postgres || failed=1
        validate_redis || failed=1
    else
        validate_docker || failed=1
    fi

    # Zusaetzliche WaWi-spezifische Tools (optional aber empfohlen)
    # openssl wird fuer JWT verwendet
    if command -v openssl &>/dev/null; then
        log "openssl OK: $(openssl version 2>&1 | head -n1)"
    else
        warn "openssl nicht gefunden (optional, empfohlen fuer JWT)"
    fi

    if [[ $failed -ne 0 ]]; then
        err "validate_environment FEHLGESCHLAGEN (OS=$os_type MODE=$mode)"
        return 1
    fi
    log "validate_environment ERFOLGREICH (OS=$os_type MODE=$mode)"
    return 0
}

# Alias fuer Rueckwaertskompatibilitaet
validate_all() { validate_environment "$@"; }

# --------------------------------------------------------------------------
# Sicherer Git-Clone (erst nach Validierung)
# --------------------------------------------------------------------------
safe_git_clone() {
    local repo_url="$1"
    local dest_dir="$2"
    # Vorgabe:  require_command git || install_git ; require_command git || fatal ...
    if ! require_command git; then
        warn "git vor Clone nicht verfuegbar - versuche Installation..."
        install_git || true
    fi
    if ! require_command git; then
        fatal "Git installation failed - git weiterhin nicht verfuegbar, Clone abgebrochen"
    fi
    validate_git || fatal "Git Validierung fehlgeschlagen vor Clone"
    info "Klone $repo_url -> $dest_dir ..."
    rm -rf "$dest_dir"
    if ! git clone "$repo_url" "$dest_dir"; then
        fatal "git clone fehlgeschlagen: $repo_url"
    fi
    log "Repo geklont nach $dest_dir"
}

# --------------------------------------------------------------------------
# Sicherer Docker-Einsatz (erst nach Validierung)
# --------------------------------------------------------------------------
ensure_docker_available() {
    local os_type="${1:-$(detect_os)}"
    if ! require_command docker; then
        warn "docker vor Einsatz nicht verfuegbar - versuche Installation (OS=$os_type)..."
        case "$os_type" in
            debian)          install_docker_debian_standard || true ;;
            debian-minimal)  install_docker_debian_minimal || true ;;
            alpine)          install_docker_alpine || true ;;
            *) fatal "Unbekannter OS-Typ fuer Docker-Installation: $os_type" ;;
        esac
    fi
    if ! require_command docker; then
        fatal "Docker installation failed - docker weiterhin nicht verfuegbar"
    fi
    validate_docker || fatal "Docker Validierung fehlgeschlagen"
    log "Docker bereit fuer Einsatz"
}

fi # COMMON_SH_LOADED
