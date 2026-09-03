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
#   --os <debian|alpine>  Basis-OS (Default: debian)
#   --mode <docker|nativ> Installationsmodus (Default: docker)
#   --no-gui            Kein whiptail, Defaults verwenden
#   --quiet             Keine Ausgabe bis zum Schluss
#   --secrets-dir <pfad>  Pfad zum Importieren von Secrets
# ============================================================================
set -euo pipefail

# ============================================================================
# Defaults
# ============================================================================
CTID="${CTID:-301}"
OS_TYPE="${OS_TYPE:-debian}"
DEPLOY_MODE="${DEPLOY_MODE:-docker}"
WEB_PORT="${WEB_PORT:-5173}"
API_PORT="${API_PORT:-3000}"
REPO_URL="https://github.com/puchadave/wawi.git"
INSTALL_DIR="/opt/wawi"
ADMIN_USER="puchadev"
SEED_FILE=""
SECRETS_DIR=""
QUIET=false
GUI=true

# Secrets Defaults (werden durch Import oder Formular überschrieben)
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

log()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
err()   { echo -e "${RED}[✗]${NC} $*"; }
info()  { echo -e "${BLUE}[i]${NC} $*"; }
header() { echo -e "\n${BOLD}${CYAN}━━━ $* ━━━${NC}\n"; }

# ============================================================================
# Argument-Parsing
# ============================================================================
parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --ctid)       CTID="$2"; shift 2 ;;
            --os)         OS_TYPE="$2"; shift 2 ;;
            --mode)       DEPLOY_MODE="$2"; shift 2 ;;
            --no-gui)     GUI=false; shift ;;
            --quiet)      QUIET=true; shift ;;
            --secrets-dir) SECRETS_DIR="$2"; shift 2 ;;
            --help|-h)
                echo "Verwendung: bash wawi.sh [OPTIONS]"
                echo "  --ctid <id>          Container-ID (Default: 301)"
                echo "  --os <debian|alpine> Basis-OS (Default: debian)"
                echo "  --mode <docker|nativ> Installationsmodus (Default: docker)"
                echo "  --no-gui             Kein whiptail, Defaults verwenden"
                echo "  --quiet              Keine Ausgabe bis zum Schluss"
                echo "  --secrets-dir <pfad> Pfad zum Importieren von Secrets"
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
        apt-get update -qq && apt-get install -y -qq whiptail
        log "whiptail installiert"
    fi

    if ! command -v git &>/dev/null; then
        warn "git nicht installiert — installiere..."
        apt-get update -qq && apt-get install -y -qq git
        log "git installiert"
    fi

    # Prüfe ob CTID bereits existiert
    if pct status "$CTID" &>/dev/null; then
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

    # Projektpfad erkennen (wenn wir im waWi Repo sind)
    local project_dir=""
    if [[ -f "$(pwd)/docker-compose.yml" ]] && [[ -d "$(pwd)/apps/api" ]]; then
        project_dir="$(pwd)"
    fi

    # .env-Dateien suchen
    for sp in "${search_paths[@]}"; do
        [[ -d "$sp" ]] || continue
        while IFS= read -r -d '' f; do
            found_files+=("$f")
        done < <(find "$sp" -maxdepth 3 -name "*.env" -o -name ".env" -o -name "*.dev" 2>/dev/null | tr '\n' '\0')
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

    # Dateien als Checkliste anzeigen
    local checklist_items=""
    for f in "${found_files[@]}"; do
        checklist_items+="\"$f\" \"\" ON "
    done

    if [[ "$GUI" == true ]]; then
        local selected
        selected=$(whiptail --checklist "Gefundene Secrets-Dateien auswählen:" 15 70 8 \
            ${checklist_items} 3>&1 1>&2 2>&3) || true

        if [[ -n "$selected" ]]; then
            # Anführungszeichen entfernen
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
    info "Lade: $file"

    # Prüfe ob es eine .env-Datei ist
    if [[ "$file" == *.env ]] || [[ "$(basename "$file")" == ".env" ]]; then
        while IFS='=' read -r key value; do
            [[ -z "$key" || "$key" == \#* || "$key" == "" ]] && continue
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

    # stack-root Passwort-Datei
    if [[ -f "$file" ]] && [[ "$file" == *pucha.dev* ]]; then
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
        whiptail --radiolist \
            "Basis-OS für den WaWi-Container wählen:" \
            15 60 2 \
            "debian" "Debian 12 (empfohlen, Docker-Stabilität)" ON \
            "alpine" "Alpine 3.20 (schlanker, ~50MB)" OFF \
            3>&1 1>&2 2>&3 && OS_TYPE="${REPLY:-debian}" || OS_TYPE="debian"
    fi

    log "OS: $OS_TYPE"
}

# ============================================================================
# [C] Installationsmodus
# ============================================================================
select_mode() {
    header "Installationsmodus wählen"

    if [[ "$GUI" == true ]]; then
        whiptail --radiolist \
            "Installationsmodus wählen:" \
            15 60 2 \
            "docker" "Docker Compose (empfohlen, stabil, isoliert)" ON \
            "nativ"  "Nativ (Node.js direkt im LXC, schneller)" OFF \
            3>&1 1>&2 2>&3 && DEPLOY_MODE="${REPLY:-docker}" || DEPLOY_MODE="docker"
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
        form=$(whiptail --form "Container-Einstellungen:" 18 65 8 \
            "Container-ID:" "$CTID" \
            "RAM (MB):" "2048" \
            "CPU (Kerne):" "2" \
            "Disk (GB):" "8" \
            "IP (CIDR, leer=DHCP):" "" \
            "Gateway:" "" \
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
            local RAM="${new_ram:-2048}"
            local CPU="${new_cpu:-2}"
            local DISK="${new_disk:-8}"
            local STATIC_IP="${new_ip}"
            local GATEWAY="${new_gw}"
        fi
    else
        local RAM="2048"
        local CPU="2"
        local DISK="8"
        local STATIC_IP=""
        local GATEWAY=""
    fi

    # CTID nochmal prüfen (kann sich geändert haben)
    if pct status "$CTID" &>/dev/null; then
        err "Container $CTID existiert bereits!"
        exit 1
    fi

    log "CTID=$CTID RAM=${RAM:-2048}MB CPU=${CPU:-2} Disk=${DISK:-8}GB"
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
        form=$(whiptail --form "API-Keys & Secrets eintragen (vorbefüllt):" 24 75 12 \
            "Shopware Base URL:" "$SHOPWARE_BASE_URL" \
            "Shopware Client ID:" "$SHOPWARE_CLIENT_ID" \
            "Shopware Client Secret:" "$SHOPWARE_CLIENT_SECRET" \
            "Shopware Tax ID:" "$SHOPWARE_TAX_ID" \
            "DATABASE_URL:" "$DATABASE_URL" \
            "REDIS_URL:" "$REDIS_URL" \
            "JWT_SECRET:" "$JWT_SECRET" \
            "Matterhorn API Key:" "$MATTERHORN_API_KEY" \
            "OpenAI API Key:" "$OPENAI_API_KEY" \
            "Web Port:" "$WEB_PORT" \
            "API Port:" "$API_PORT" \
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

    local TEMPLATE=""
    local STORAGE="local"
    local BRIDGE="vmbr0"

    if [[ "$OS_TYPE" == "debian" ]]; then
        TEMPLATE="debian-12-standard"
    else
        TEMPLATE="alpine-3.20"
    fi

    # Template herunterladen falls nicht vorhanden
    info "Prüfe Template: $TEMPLATE"
    pveam update -qq 2>/dev/null || true

    if ! pveam available | grep -q "$TEMPLATE"; then
        err "Template $TEMPLATE nicht verfügbar!"
        exit 1
    fi

    if ! pveam list "$STORAGE" | grep -q "$TEMPLATE"; then
        info "Lade Template herunter: $TEMPLATE"
        pveam download "$STORAGE" "$TEMPLATE"
        log "Template heruntergeladen"
    else
        log "Template vorhanden: $TEMPLATE"
    fi

    # Mount-Punkt für Quellen
    local SRC_MNT="/mnt/pve/wawi-src"
    mkdir -p "$SRC_MNT"
    cp -r /opt/wawi "$SRC_MNT/wawi" 2>/dev/null || {
        # Falls /opt/wawi nicht existiert, klonen wir nachher im Container
        mkdir -p "$SRC_MNT/wawi"
    }

    # LXC erstellen
    info "Erstelle Container $CTID..."

    # Netzwerk-Parameter
    local NET_PARAM="name=eth0,bridge=${BRIDGE},hwaddr=$(printf '02:%02x:%02x:%02x:%02x:%02x' $((RANDOM%256)) $((RANDOM%256)) $((RANDOM%256)) $((RANDOM%256)) $((RANDOM%256)) $((RANDOM%256)))"
    if [[ -n "${STATIC_IP:-}" ]]; then
        NET_PARAM+=",ip=${STATIC_IP}"
        [[ -n "${GATEWAY:-}" ]] && NET_PARAM+=",gw=${GATEWAY}"
    else
        NET_PARAM+=",ip=dhcp"
    fi

    # Debian-Speicher-Rootfs optimiert
    local DISK_SIZE="${DISK:-8}G"

    pct create "$CTID" "${STORAGE}:vztmpl/${TEMPLATE}.tar.zst" \
        --hostname "wawi-${CTID}" \
        --memory "${RAM:-2048}" \
        --cores "${CPU:-2}" \
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

    # Node vom Hersteller (immer aktuelle LTS/Current)
    if [[ "$OS_TYPE" == "debian" ]]; then
        pct exec "$CTID" -- bash -c "
            apt-get update -qq &&
            apt-get install -y -qq curl git build-essential &&
            curl -fsSL https://deb.nodesource.com/setup_26.x | bash - &&
            apt-get install -y -qq nodejs
        "
    else
        # Alpine: Node direkt vom Hersteller (nodejs.org)
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

    # API starten (persistent via systemd)
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
    log "API-Service gestartet"

    # Web: nginx + static build
    if [[ "$OS_TYPE" == "debian" ]]; then
        pct exec "$CTID" -- bash -c "
            apt-get install -y -qq nginx &&
            cp -r $INSTALL_DIR/apps/web/dist/* /var/www/html/ &&
            systemctl enable nginx &&
            systemctl restart nginx
        "
    else
        pct exec "$CTID" -- bash -c "
            apk add nginx &&
            cp -r $INSTALL_DIR/apps/web/dist/* /var/www/localhost/htdocs/ &&
            rc-update add nginx default &&
            service nginx start
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
        api_ip=$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')
        if curl -sf "http://${api_ip}:${API_PORT}/health" >/dev/null 2>&1; then
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

    if [[ "$GUI" == true ]]; then
        local backup_path
        backup_path=$(whiptail --inputbox "Pfad für Credential-Backup (Enter = überspringen):" 10 60 "/gdrive/wawi" 3>&1 1>&2 2>&3) || true

        if [[ -n "$backup_path" ]]; then
            mkdir -p "$backup_path"

            # .env sichern
            pct pull "$CTID" "$INSTALL_DIR/.env" "$backup_path/.env" 2>/dev/null || true

            # Passwort sichern
            if [[ -n "$SEED_FILE" ]] && [[ -f "$SEED_FILE" ]]; then
                cp "$SEED_FILE" "$backup_path/pucha.dev"
            fi

            # Zusammenfassung
            local api_ip
            api_ip=$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')

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

    local api_ip
    api_ip=$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')
    [[ -z "$api_ip" ]] && api_ip="<CT-IP>"

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
