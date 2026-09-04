#!/usr/bin/env bash
# ============================================================================
# WaWi PVE Helper-Script
# Automatische LXC-Installation der WaWi Middleware (Matterhorn → Shopware 6)
#
# Verwendung:
#   bash wawi.sh                      # Interaktiver Modus (whiptail GUI)
#   bash wawi.sh --no-gui --quiet     # Headless/Automatisiert
#
# Flags:
#   --ctid <id>         Container-ID (Default: 301)
#   --os <alpine|debian>  Basis-OS (Default: alpine)
#   --mode <docker|nativ> Installationsmodus (Default: docker)
#   --no-gui            Kein whiptail, Defaults verwenden
#   --quiet             Keine Ausgabe bis zum Schluss
#   --secrets-dir <pfad>  Pfad zum Importieren von Secrets
#   --dry-run           Nur Menüs durchspielen, keinen Container erstellen
# ============================================================================
set -euo pipefail

# ============================================================================
# Defaults
# ============================================================================
CTID=301
OS_TYPE="alpine"
DEPLOY_MODE="docker"
WEB_PORT=5173
API_PORT=3000
REPO_URL="https://github.com/puchadave/wawi.git"
INSTALL_DIR="/opt/wawi"
ADMIN_USER="puchadev"
SEED_FILE=""
SECRETS_DIR=""
QUIET=false
GUI=true
DRY_RUN=false
STATIC_IP=""
GATEWAY=""
RAM=2048
CPU=2
DISK=8

# Secrets Defaults
SHOPWARE_BASE_URL="https://uptempo.pucha.dev"
SHOPWARE_CLIENT_ID=""
SHOPWARE_CLIENT_SECRET=""
SHOPWARE_TAX_ID=""
DATABASE_URL="postgresql://wawi:wawi_password@localhost:5432/wawi_db"
REDIS_URL="redis://localhost:6379"
JWT_SECRET=""
MATTERHORN_API_KEY=""
OPENAI_API_KEY=""
WEB_URL=""

# ============================================================================
# Farben & Logging
# ============================================================================
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

# ============================================================================
# Argument-Parsing
# ============================================================================
parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --ctid)        CTID="$2"; shift 2 ;;
            --os)          OS_TYPE="$2"; shift 2 ;;
            --mode)        DEPLOY_MODE="$2"; shift 2 ;;
            --no-gui)      GUI=false; shift ;;
            --quiet)       QUIET=true; shift ;;
            --dry-run)     DRY_RUN=true; shift ;;
            --secrets-dir) SECRETS_DIR="$2"; shift 2 ;;
            --help|-h)
                echo "Verwendung: bash wawi.sh [OPTIONS]"
                echo "  --ctid <id>            Container-ID (Default: 301)"
                echo "  --os <alpine|debian>   Basis-OS (Default: alpine)"
                echo "  --mode <docker|nativ>  Installationsmodus (Default: docker)"
                echo "  --no-gui               Kein whiptail"
                echo "  --quiet                Keine Ausgabe bis zum Schluss"
                echo "  --dry-run              Nur Menüs, kein Deployment"
                echo "  --secrets-dir <pfad>   Pfad zum Secret-Import"
                exit 0
                ;;
            *) err "Unbekanntes Argument: $1"; exit 1 ;;
        esac
    done
}

# ============================================================================
# Host-Prüfungen
# ============================================================================
check_host() {
    header "Host-Prüfung"

    if [[ $EUID -ne 0 ]]; then
        err "Dieses Script muss als root ausgeführt werden."
        exit 1
    fi
    log "Root-Zugang OK"

    if ! command -v pct &>/dev/null; then
        err "pct nicht gefunden — kein Proxmox VE Host?"
        exit 1
    fi
    log "Proxmox VE erkannt"

    if ! command -v pvesm &>/dev/null; then
        err "pvesm nicht gefunden."
        exit 1
    fi
    log "pvesm erkannt"

    if [[ "$GUI" == true ]] && ! command -v whiptail &>/dev/null; then
        warn "whiptail nicht installiert — installiere..."
        if command -v apt-get &>/dev/null; then
            apt-get update -qq && apt-get install -y -qq whiptail
        elif command -v apk &>/dev/null; then
            apk add --no-cache whiptail
        fi
        log "whiptail installiert"
    fi

    if ! command -v git &>/dev/null; then
        warn "git nicht installiert — installiere..."
        if command -v apt-get &>/dev/null; then
            apt-get update -qq && apt-get install -y -qq git
        elif command -v apk &>/dev/null; then
            apk add --no-cache git
        fi
        log "git installiert"
    fi

    # Prüfe ob CTID bereits existiert
    if pct status "$CTID" &>/dev/null 2>&1; then
        err "Container $CTID existiert bereits!"
        [[ "$GUI" == true ]] && whiptail --msgbox "Container $CTID existiert bereits.\nWähle eine andere ID oder lösche den bestehenden Container." 10 50
        exit 1
    fi
    log "Container-ID $CTID ist frei"
}

# ============================================================================
# [A] Secrets-Import
# ============================================================================
import_secrets() {
    header "Secrets & Credentials importieren"

    local search_paths=()
    local found_files=()

    # Standard-Suchpfade
    search_paths+=("$(pwd)")
    [[ -n "$SECRETS_DIR" ]] && search_paths+=("$SECRETS_DIR")

    # Projektpfad erkennen
    local project_dir=""
    if [[ -f "$(pwd)/docker-compose.yml" ]] && [[ -d "$(pwd)/apps/api" ]]; then
        project_dir="$(pwd)"
    fi

    # .env-Dateien suchen
    for sp in "${search_paths[@]}"; do
        [[ -d "$sp" ]] || continue
        while IFS= read -r -d '' f; do
            found_files+=("$f")
        done < <(find "$sp" -maxdepth 3 \( -name "*.env" -o -name ".env" -o -name "*.dev" \) 2>/dev/null | tr '\n' '\0')
    done

    # stack-root Passwörter suchen
    if [[ -n "$project_dir" ]]; then
        while IFS= read -r -d '' f; do
            found_files+=("$f")
        done < <(find "$project_dir" -maxdepth 4 -path "*/stack-root/*" -type f 2>/dev/null | tr '\n' '\0')
    fi

    if [[ ${#found_files[@]} -eq 0 ]]; then
        warn "Keine bestehenden Secrets-Dateien gefunden."
        [[ "$GUI" == true ]] && whiptail --msgbox "Keine .env oder Credentials-Dateien gefunden.\nDie Secrets müssen manuell eingegeben werden." 10 50
        return 0
    fi

    if [[ "$GUI" == true ]]; then
        local checklist_args=()
        for f in "${found_files[@]}"; do
            checklist_args+=("$f" "" "ON")
        done

        local selected
        selected=$(whiptail --checklist "Gefundene Secrets-Dateien auswählen:" 15 70 8 \
            "${checklist_args[@]}" 3>&1 1>&2 2>&3) || true

        if [[ -n "$selected" ]]; then
            selected=$(echo "$selected" | tr -d '"' | tr -d '\n')
            for f in $selected; do
                load_env_file "$f"
            done
        fi
    else
        info "Gefundene Dateien:"
        for f in "${found_files[@]}"; do
            echo "  - $f"
        done
    fi
}

load_env_file() {
    local file="$1"
    [[ -f "$file" ]] || return 0
    info "Lade: $file"

    if [[ "$file" == *.env ]] || [[ "$(basename "$file")" == ".env" ]]; then
        while IFS='=' read -r key value; do
            [[ -z "$key" || "$key" == \#* ]] && continue
            key=$(echo "$key" | xargs)
            value=$(echo "$value" | xargs | tr -d '"')

            case "$key" in
                SHOPWARE_BASE_URL)      SHOPWARE_BASE_URL="$value" ;;
                SHOPWARE_CLIENT_ID)     SHOPWARE_CLIENT_ID="$value" ;;
                SHOPWARE_CLIENT_SECRET) SHOPWARE_CLIENT_SECRET="$value" ;;
                SHOPWARE_TAX_ID)        SHOPWARE_TAX_ID="$value" ;;
                DATABASE_URL)           DATABASE_URL="$value" ;;
                REDIS_URL)              REDIS_URL="$value" ;;
                JWT_SECRET)             JWT_SECRET="$value" ;;
                MATTERHORN_API_KEY)     MATTERHORN_API_KEY="$value" ;;
                OPENAI_API_KEY)         OPENAI_API_KEY="$value" ;;
                WEB_URL)                WEB_URL="$value" ;;
            esac
        done < "$file"
        log "Env-Werte aus $(basename "$file") geladen"
    fi

    if [[ "$file" == *pucha.dev* ]]; then
        SEED_FILE="$file"
        log "Bootstrap-Passwort-Datei gefunden: $file"
    fi
}

# ============================================================================
# [B] OS-Auswahl
# ============================================================================
select_os() {
    header "Betriebssystem wählen"

    if [[ "$GUI" == true ]]; then
        local choice
        choice=$(whiptail --radiolist \
            "Basis-OS für den WaWi-Container wählen:" \
            15 60 2 \
            "alpine" "Alpine 3.20 (empfohlen, schlank)" ON \
            "debian" "Debian 12 (größer, Docker-Stabilität)" OFF \
            3>&1 1>&2 2>&3) || choice="alpine"
        OS_TYPE="$choice"
    fi

    log "OS: $OS_TYPE"
}

# ============================================================================
# [C] Installationsmodus
# ============================================================================
select_mode() {
    header "Installationsmodus wählen"

    if [[ "$GUI" == true ]]; then
        local choice
        choice=$(whiptail --radiolist \
            "Installationsmodus wählen:" \
            15 60 2 \
            "docker" "Docker Compose (empfohlen, stabil, isoliert)" ON \
            "nativ"  "Nativ (Node.js direkt im LXC, schneller)" OFF \
            3>&1 1>&2 2>&3) || choice="docker"
        DEPLOY_MODE="$choice"
    fi

    log "Modus: $DEPLOY_MODE"
}

# ============================================================================
# [D] Container-Konfiguration
# ============================================================================
configure_container() {
    header "Container-Konfiguration"

    if [[ "$GUI" == true ]]; then
        local form
        form=$(whiptail --form "Container-Einstellungen:" 16 70 6 \
            "Container-ID:" 1 1  "$CTID" 1 18 10 0 \
            "RAM (MB):"     2 1  "$RAM"  2 18 10 0 \
            "CPU (Kerne):"  3 1  "$CPU"  3 18 8 0 \
            "Disk (GB):"    4 1  "$DISK" 4 18 8 0 \
            "IP (CIDR, leer=DHCP):" 5 1 "$STATIC_IP" 5 18 18 0 \
            "Gateway:"      6 1  "$GATEWAY" 6 18 18 0 \
            3>&1 1>&2 2>&3) || true

        if [[ -n "$form" ]]; then
            local new_ctid new_ram new_cpu new_disk new_ip new_gw
            new_ctid=$(echo "$form" | sed -n '1p')
            new_ram=$(echo "$form" | sed -n '2p')
            new_cpu=$(echo "$form" | sed -n '3p')
            new_disk=$(echo "$form" | sed -n '4p')
            new_ip=$(echo "$form" | sed -n '5p')
            new_gw=$(echo "$form" | sed -n '6p')

            [[ -n "$new_ctid" ]] && CTID="$new_ctid"
            [[ -n "$new_ram" ]] && RAM="$new_ram"
            [[ -n "$new_cpu" ]] && CPU="$new_cpu"
            [[ -n "$new_disk" ]] && DISK="$new_disk"
            [[ -n "$new_ip" ]] && STATIC_IP="$new_ip"
            [[ -n "$new_gw" ]] && GATEWAY="$new_gw"
        fi
    fi

    # CTID validieren
    if [[ ! "$CTID" =~ ^[0-9]+$ ]]; then
        warn "Ungültige CT-ID: $CTID — nutze 301"
        CTID=301
    fi

    # CTID nochmal prüfen (kann sich geändert haben)
    if [[ "$DRY_RUN" == false ]] && pct status "$CTID" &>/dev/null 2>&1; then
        err "Container $CTID existiert bereits!"
        exit 1
    fi

    log "CTID=$CTID RAM=${RAM}MB CPU=${CPU} Disk=${DISK}GB IP=${STATIC_IP:-DHCP}"
}

# ============================================================================
# [E] API-Keys & Secrets Formular
# ============================================================================
configure_secrets() {
    header "API-Keys & Secrets konfigurieren"

    # JWT Secret generieren falls leer
    if [[ -z "$JWT_SECRET" ]]; then
        JWT_SECRET=$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 64)
        log "JWT_SECRET automatisch generiert"
    fi

    if [[ "$GUI" == true ]]; then
        local form
        form=$(whiptail --form "API-Keys & Secrets eintragen (vorbefüllt):" 22 75 11 \
            "Shopware Base URL:" 1 1 "$SHOPWARE_BASE_URL" 1 22 40 0 \
            "Shopware Client ID:" 2 1 "$SHOPWARE_CLIENT_ID" 2 22 40 0 \
            "Shopware Client Secret:" 3 1 "$SHOPWARE_CLIENT_SECRET" 3 22 40 0 \
            "Shopware Tax ID:" 4 1 "$SHOPWARE_TAX_ID" 4 22 40 0 \
            "DATABASE_URL:" 5 1 "$DATABASE_URL" 5 22 40 0 \
            "REDIS_URL:" 6 1 "$REDIS_URL" 6 22 40 0 \
            "JWT_SECRET:" 7 1 "$JWT_SECRET" 7 22 40 0 \
            "Matterhorn API Key:" 8 1 "$MATTERHORN_API_KEY" 8 22 40 0 \
            "OpenAI API Key:" 9 1 "$OPENAI_API_KEY" 9 22 40 0 \
            "Web Port:" 10 1 "$WEB_PORT" 10 22 10 0 \
            "API Port:" 11 1 "$API_PORT" 11 22 10 0 \
            3>&1 1>&2 2>&3) || true

        if [[ -n "$form" ]]; then
            SHOPWARE_BASE_URL=$(echo "$form" | sed -n '1p')
            SHOPWARE_CLIENT_ID=$(echo "$form" | sed -n '2p')
            SHOPWARE_CLIENT_SECRET=$(echo "$form" | sed -n '3p')
            SHOPWARE_TAX_ID=$(echo "$form" | sed -n '4p')
            DATABASE_URL=$(echo "$form" | sed -n '5p')
            REDIS_URL=$(echo "$form" | sed -n '6p')
            JWT_SECRET=$(echo "$form" | sed -n '7p')
            MATTERHORN_API_KEY=$(echo "$form" | sed -n '8p')
            OPENAI_API_KEY=$(echo "$form" | sed -n '9p')
            WEB_PORT=$(echo "$form" | sed -n '10p')
            API_PORT=$(echo "$form" | sed -n '11p')
        fi
    fi

    log "Secrets konfiguriert"
}

# ============================================================================
# [F] LXC erstellen
# ============================================================================
create_lxc() {
    header "LXC-Container erstellen"

    if [[ "$DRY_RUN" == true ]]; then
        info "DRY-RUN: Überspringe LXC-Erstellung"
        log "CTID=$CTID OS=$OS_TYPE MODUS=$DEPLOY_MODE RAM=${RAM}CPU=${CPU}DISK=${DISK}"
        return 0
    fi

    local TEMPLATE=""
    local STORAGE="local"
    local BRIDGE="vmbr0"

    if [[ "$OS_TYPE" == "debian" ]]; then
        TEMPLATE="debian-12"
    else
        TEMPLATE="alpine-3.20"
    fi

    # Template-Handling: pveam update (fehlertolerant)
    info "Aktualisiere Template-Liste..."
    pveam update 2>/dev/null || warn "pveam update hatte Fehler (nicht kritisch)"

    # Template suchen (Präfix-Match)
    info "Suche Template: ${TEMPLATE}*"
    local available_template
    available_template=$(pveam available 2>/dev/null | grep -i "${TEMPLATE}" | awk '{print $2}' | head -1 || true)

    if [[ -z "$available_template" ]]; then
        err "Template für $TEMPLATE nicht verfügbar!"
        err "Verfügbare Templates:"
        pveam available 2>/dev/null | grep -iE "alpine|debian" | head -10 || true
        exit 1
    fi

    # Prüfe ob Template lokal vorhanden
    if ! pveam list "$STORAGE" 2>/dev/null | grep -q "$available_template"; then
        info "Lade Template herunter: $available_template"
        pveam download "$STORAGE" "$available_template" || {
            err "Template-Download fehlgeschlagen!"
            exit 1
        }
        log "Template heruntergeladen: $available_template"
    else
        log "Template vorhanden: $available_template"
    fi

    # Netzwerk-Parameter
    local NET_PARAM="name=eth0,bridge=${BRIDGE},hwaddr=$(printf '02:%02x:%02x:%02x:%02x:%02x' $((RANDOM%256)) $((RANDOM%256)) $((RANDOM%256)) $((RANDOM%256)) $((RANDOM%256)) $((RANDOM%256)))"
    if [[ -n "$STATIC_IP" ]]; then
        NET_PARAM+=",ip=${STATIC_IP}"
        [[ -n "$GATEWAY" ]] && NET_PARAM+=",gw=${GATEWAY}"
    else
        NET_PARAM+=",ip=dhcp"
    fi

    local DISK_SIZE="${DISK}G"

    # LXC erstellen
    info "Erstelle Container $CTID..."
    pct create "$CTID" "${STORAGE}:vztmpl/${available_template}" \
        --hostname "wawi-${CTID}" \
        --memory "$RAM" \
        --cores "$CPU" \
        --rootfs "${STORAGE}:${DISK_SIZE}" \
        --net0 "$NET_PARAM" \
        --ostype "$OS_TYPE" \
        --unprivileged 1 \
        --onboot 0 \
        --features "nesting=1" \
        --description "WaWi Middleware - Matterhorn to Shopware 6"

    log "Container $CTID erstellt"

    # Container starten
    pct start "$CTID"
    info "Warte bis Container gebootet ist..."

    local retries=30
    while [[ $retries -gt 0 ]]; do
        if pct exec "$CTID" -- true 2>/dev/null; then
            log "Container $CTID läuft"
            break
        fi
        sleep 2
        retries=$((retries - 1))
    done

    if [[ $retries -eq 0 ]]; then
        err "Container $CTID konnte nicht gestartet werden"
        exit 1
    fi
}

# ============================================================================
# [H] Deployment
# ============================================================================
deploy_app() {
    header "WaWi deployen"

    if [[ "$DRY_RUN" == true ]]; then
        info "DRY-RUN: Überspringe Deployment"
        return 0
    fi

    if [[ "$DEPLOY_MODE" == "docker" ]]; then
        deploy_docker
    else
        deploy_nativ
    fi
}

deploy_docker() {
    info "Installiere Docker im Container..."

    if [[ "$OS_TYPE" == "debian" ]]; then
        pct exec "$CTID" -- bash -c "
            apt-get update -qq &&
            apt-get install -y -qq ca-certificates curl gnupg &&
            install -m 0755 -d /etc/apt/keyrings &&
            curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg &&
            chmod a+r /etc/apt/keyrings/docker.gpg &&
            echo \"deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \$(. /etc/os-release && echo \$VERSION_CODENAME) stable\" > /etc/apt/sources.list.d/docker.list &&
            apt-get update -qq &&
            apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin &&
            systemctl enable docker &&
            systemctl start docker
        "
    else
        pct exec "$CTID" -- bash -c "
            apk update &&
            apk add docker docker-compose &&
            rc-update add docker boot &&
            service docker start
        "
    fi
    log "Docker installiert"

    # Git klonen
    info "Klone WaWi-Repo..."
    pct exec "$CTID" -- bash -c "
        rm -rf $INSTALL_DIR &&
        git clone $REPO_URL $INSTALL_DIR
    "
    log "Repo geklont"

    # .env generieren
    generate_env

    # Docker Compose starten
    info "Baue und starte Container..."
    pct exec "$CTID" -- bash -c "
        cd $INSTALL_DIR &&
        WEB_PORT=$WEB_PORT docker compose up -d --build
    "
    log "Docker Compose gestartet"
}

deploy_nativ() {
    info "Installiere Node.js im Container..."

    if [[ "$OS_TYPE" == "debian" ]]; then
        pct exec "$CTID" -- bash -c "
            apt-get update -qq &&
            apt-get install -y -qq curl git build-essential &&
            curl -fsSL https://deb.nodesource.com/setup_26.x | bash - &&
            apt-get install -y -qq nodejs
        "
    else
        # Alpine: Node direkt vom Hersteller
        pct exec "$CTID" -- bash -c "
            apk add --no-cache curl git python3 make g++ &&
            NODE_VERSION=\$(curl -s https://nodejs.org/dist/index.json | grep -oP '\"version\":\"v\\K[0-9.]+' | head -1) &&
            curl -fsSL \"https://nodejs.org/dist/v\${NODE_VERSION}/node-v\${NODE_VERSION}-linux-x64-musl.tar.xz\" -o /tmp/node.tar.xz &&
            tar -xf /tmp/node.tar.xz -C /usr/local --strip-components=1 &&
            rm /tmp/node.tar.xz
        "
    fi
    log "Node.js installiert"

    # Git klonen
    info "Klone WaWi-Repo..."
    pct exec "$CTID" -- bash -c "
        rm -rf $INSTALL_DIR &&
        git clone $REPO_URL $INSTALL_DIR
    "
    log "Repo geklont"

    # .env generieren
    generate_env

    # Dependencies installieren & bauen
    info "Installiere Dependencies & baue..."
    pct exec "$CTID" -- bash -c "
        cd $INSTALL_DIR &&
        npm ci --ignore-scripts &&
        npm run build --workspace=@wawi/api &&
        npm run build --workspace=@wawi/web
    "
    log "Build abgeschlossen"

    # API starten (persistent via openrc auf Alpine)
    if [[ "$OS_TYPE" == "alpine" ]]; then
        pct exec "$CTID" -- bash -c "
            cat > /etc/init.d/wawi-api << 'INITEOF'
#!/sbin/openrc-run

name=\"wawi-api\"
description=\"WaWi API Server\"
command=\"/usr/local/bin/node\"
command_args=\"$INSTALL_DIR/apps/api/dist/index.js\"
command_background=true
pidfile=\"/run/wawi-api.pid\"
output_log=\"/var/log/wawi-api.log\"
error_log=\"/var/log/wawi-api.log\"

depend() {
    need net
    after docker
}

start_pre() {
    export \$(cat $INSTALL_DIR/.env | grep -v '^#' | xargs)
}
INITEOF
            chmod +x /etc/init.d/wawi-api &&
            rc-update add wawi-api default &&
            rc-service wawi-api start
        "
    else
        pct exec "$CTID" -- bash -c "
            cat > /etc/systemd/system/wawi-api.service << 'EOF'
[Unit]
Description=WaWi API
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR/apps/api
ExecStart=$(which node) dist/index.js
Restart=on-failure
RestartSec=5
EnvironmentFile=$INSTALL_DIR/.env

[Install]
WantedBy=multi-user.target
EOF
            systemctl daemon-reload &&
            systemctl enable wawi-api &&
            systemctl start wawi-api
        "
    fi
    log "API-Service gestartet"

    # Web: nginx + static build
    if [[ "$OS_TYPE" == "alpine" ]]; then
        pct exec "$CTID" -- bash -c "
            apk add nginx &&
            cp -r $INSTALL_DIR/apps/web/dist/* /var/www/localhost/htdocs/ &&
            rc-update add nginx default &&
            service nginx start
        "
    else
        pct exec "$CTID" -- bash -c "
            apt-get install -y -qq nginx &&
            cp -r $INSTALL_DIR/apps/web/dist/* /var/www/html/ &&
            systemctl enable nginx &&
            systemctl restart nginx
        "
    fi
    log "Web-Server gestartet"
}

generate_env() {
    info "Generiere .env..."

    local env_content="# Auto-generiert durch WaWi Installer
# $(date -Iseconds)

# App Config
NODE_ENV=production
PORT=${API_PORT}
HOST=0.0.0.0

# Database
DATABASE_URL=${DATABASE_URL}

# Redis
REDIS_URL=${REDIS_URL}

# Matterhorn API
MATTERHORN_API_KEY=${MATTERHORN_API_KEY}

# Shopware API
SHOPWARE_BASE_URL=${SHOPWARE_BASE_URL}
SHOPWARE_CLIENT_ID=${SHOPWARE_CLIENT_ID}
SHOPWARE_CLIENT_SECRET=${SHOPWARE_CLIENT_SECRET}
SHOPWARE_TAX_ID=${SHOPWARE_TAX_ID}
SHOPWARE_CURRENCY_ID=b7d2554b0ce847cd82f3ac9bd1c0dfca

# OpenAI API
OPENAI_API_KEY=${OPENAI_API_KEY}

# JWT Secret
JWT_SECRET=${JWT_SECRET}

# Web URL (für CORS)
WEB_URL=${WEB_URL}
"

    pct exec "$CTID" -- bash -c "cat > $INSTALL_DIR/.env << 'ENVEOF'
${env_content}
ENVEOF"
    log ".env generiert"
}

# ============================================================================
# [I] Health-Check
# ============================================================================
health_check() {
    header "Health-Check"

    if [[ "$DRY_RUN" == true ]]; then
        info "DRY-RUN: Überspringe Health-Check"
        return 0
    fi

    # Bootstrap-Admin prüfen
    local stack_root="$INSTALL_DIR/stack-root"
    local seed_installed=false

    # Falls wir eine lokale seed-Datei haben, kopiere sie in den Container
    if [[ -n "$SEED_FILE" ]] && [[ -f "$SEED_FILE" ]]; then
        pct push "$CTID" "$SEED_FILE" "$stack_root/pucha.dev"
        seed_installed=true
        log "Bootstrap-Passwort-Datei in Container kopiert"
    fi

    # Warte auf API
    info "Warte auf API..."
    local retries=30
    while [[ $retries -gt 0 ]]; do
        local api_ip
        api_ip=$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}') || true
        if [[ -n "$api_ip" ]] && curl -sf "http://${api_ip}:${API_PORT}/health" >/dev/null 2>&1; then
            log "API antwortet auf Port ${API_PORT}"
            break
        fi
        sleep 3
        retries=$((retries - 1))
    done

    if [[ $retries -eq 0 ]]; then
        warn "API antwortet noch nicht — möglicherweise noch beim Starten"
    fi

    # Bootstrap-Passwort anzeigen
    if [[ "$seed_installed" == true ]]; then
        local pw
        pw=$(cat "$SEED_FILE" 2>/dev/null || echo "unbekannt")
        log "Bootstrap-Admin: $ADMIN_USER / Passwort: $pw"
    fi
}

# ============================================================================
# [J] GDrive-Backup
# ============================================================================
backup_credentials() {
    header "Zugangsdaten sichern"

    if [[ "$DRY_RUN" == true ]]; then
        info "DRY-RUN: Überspringe Backup"
        return 0
    fi

    if [[ "$GUI" == true ]]; then
        local backup_path
        backup_path=$(whiptail --inputbox "Pfad für Credential-Backup (Enter = überspringen):" 10 60 "/gdrive/wawi" 3>&1 1>&2 2>&3) || true

        if [[ -n "$backup_path" ]]; then
            mkdir -p "$backup_path"

            pct pull "$CTID" "$INSTALL_DIR/.env" "$backup_path/.env" 2>/dev/null || true

            if [[ -n "$SEED_FILE" ]] && [[ -f "$SEED_FILE" ]]; then
                cp "$SEED_FILE" "$backup_path/pucha.dev"
            fi

            local api_ip
            api_ip=$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}') || api_ip="<CT-IP>"

            cat > "$backup_path/wawi-access.txt" << EOF
WaWi Middleware - Zugangsdaten
===============================
Erstellt: $(date -Iseconds)

Container-ID:   $CTID
Container-IP:   $api_ip

Web-UI:         http://${api_ip}:${WEB_PORT}/login
API-Health:     http://${api_ip}:${API_PORT}/health
API-Login:      http://${api_ip}:${API_PORT}/api/auth/login

Admin-User:     $ADMIN_USER
Admin-Passwort: $(cat "$SEED_FILE" 2>/dev/null || echo "siehe stack-root/pucha.dev im Container")

Ports:
  Web:          $WEB_PORT
  API:          $API_PORT
  PostgreSQL:   5432 (intern)
  Redis:        6379 (intern)

Deployment-Modus: $DEPLOY_MODE
Basis-OS:         $OS_TYPE
EOF

            log "Backup gespeichert: $backup_path"
        fi
    fi
}

# ============================================================================
# Zusammenfassung
# ============================================================================
show_summary() {
    header "Installation abgeschlossen"

    local api_ip="<CT-IP>"
    if [[ "$DRY_RUN" == false ]]; then
        api_ip=$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}') || api_ip="<CT-IP>"
    fi

    local pw="siehe stack-root/pucha.dev im Container"
    [[ -n "$SEED_FILE" ]] && [[ -f "$SEED_FILE" ]] && pw=$(cat "$SEED_FILE")

    echo -e "${BOLD}${GREEN}"
    echo "╔══════════════════════════════════════════════════════════╗"
    echo "║              WaWi Middleware - Installation             ║"
    echo "╠══════════════════════════════════════════════════════════╣"
    echo "║                                                        ║"
    echo "║  Web-UI:    http://${api_ip}:${WEB_PORT}/login"
    echo "║  API:       http://${api_ip}:${API_PORT}/health"
    echo "║                                                        ║"
    echo "║  Username:  ${ADMIN_USER}"
    echo "║  Passwort:  ${pw}"
    echo "║                                                        ║"
    echo "║  Container:  CT ${CTID}"
    echo "║  OS:         ${OS_TYPE}"
    echo "║  Modus:      ${DEPLOY_MODE}"
    echo "║                                                        ║"
    echo "╠══════════════════════════════════════════════════════════╣"
    echo "║  Port-Übersicht:                                       ║"
    echo "║    Web:         ${WEB_PORT}                              ║"
    echo "║    API:         ${API_PORT}                              ║"
    echo "║    PostgreSQL:  5432 (intern)                          ║"
    echo "║    Redis:       6379 (intern)                          ║"
    echo "╠══════════════════════════════════════════════════════════╣"
    echo "║  Nützliche Befehle:                                     ║"
    echo "║    pct enter ${CTID}           # Container betreten      ║"
    echo "║    pct reboot ${CTID}          # Container neustarten    ║"
    echo "║    pct exec ${CTID} -- docker compose logs -f          ║"
    echo "╚══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# ============================================================================
# Hauptprogramm
# ============================================================================
main() {
    parse_args "$@"

    if [[ "$QUIET" == false ]]; then
        echo -e "${BOLD}${CYAN}"
        echo "╔══════════════════════════════════════════════════╗"
        echo "║     WaWi PVE Helper - Installation              ║"
        echo "║     Matterhorn → Shopware 6 Middleware           ║"
        [[ "$DRY_RUN" == true ]] && echo "║     *** DRY-RUN MODE ***                        ║"
        echo "╚══════════════════════════════════════════════════╝"
        echo -e "${NC}"
    fi

    check_host
    import_secrets
    select_os
    select_mode
    configure_container
    configure_secrets
    create_lxc
    deploy_app
    health_check
    backup_credentials
    show_summary
}

main "$@"
