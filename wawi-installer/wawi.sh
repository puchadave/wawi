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
DEBIAN_VARIANT="standard"  # standard | minimal (nur relevant wenn OS_TYPE=debian)

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
# Gemeinsame Bibliothek (lib/common.sh) - falls vorhanden einbinden
# ---------------------------------------------------------------------------
# Stellt sicher dass validate_environment, require_command, install_* etc.
# zentral gepflegt sind. Fallback: Definitionen hier, falls lib fehlt.
# ============================================================================
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
COMMON_SH="${SCRIPT_DIR}/lib/common.sh"
if [[ -f "$COMMON_SH" ]]; then
    # shellcheck source=/dev/null
    source "$COMMON_SH" 2>/dev/null || true
fi

# Fallback falls lib/common.sh nicht geladen (z.B. curl-pipe)
if ! declare -F validate_environment &>/dev/null; then
    # Minimal-Fallback: nur validate_environment stub, echte Pruefung erfolgt im Container via lib
    validate_environment() { echo "[i] validate_environment Fallback (OS=${1:-unknown} MODE=${2:-docker})"; return 0; }
    require_command() { command -v "$1" &>/dev/null; }
fi

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
            --os)
                case "$2" in
                    debian-minimal|debian:minimal) OS_TYPE="debian"; DEBIAN_VARIANT="minimal" ;;
                    debian-standard|debian:standard) OS_TYPE="debian"; DEBIAN_VARIANT="standard" ;;
                    debian|alpine) OS_TYPE="$2" ;;
                    *) err "Unbekanntes --os: $2 (erlaubt: debian, debian-minimal, alpine)"; exit 1 ;;
                esac
                shift 2
                ;;
            --debian-variant) DEBIAN_VARIANT="$2"; shift 2 ;;
            --mode)        DEPLOY_MODE="$2"; shift 2 ;;
            --no-gui)      GUI=false; shift ;;
            --quiet)       QUIET=true; shift ;;
            --dry-run)     DRY_RUN=true; shift ;;
            --secrets-dir) SECRETS_DIR="$2"; shift 2 ;;
            --help|-h)
                echo "Verwendung: bash wawi.sh [OPTIONS]"
                echo "  --ctid <id>                    Container-ID (Default: 301)"
                echo "  --os <alpine|debian|debian-minimal> Basis-OS (Default: alpine)"
                echo "  --debian-variant <standard|minimal> Debian-Variante (Default: standard)"
                echo "  --mode <docker|nativ>          Installationsmodus (Default: docker)"
                echo "  --no-gui                       Kein whiptail"
                echo "  --quiet                        Keine Ausgabe bis zum Schluss"
                echo "  --dry-run                      Nur Menüs, kein Deployment"
                echo "  --secrets-dir <pfad>           Pfad zum Secret-Import"
                echo ""
                echo "Installer-Pfade:"
                echo "  wawi-installer/install-debian.sh         (Debian Standard, offizielles Docker-Repo)"
                echo "  wawi-installer/install-debian-minimal.sh (Debian Minimal, --no-install-recommends)"
                echo "  wawi-installer/install-alpine.sh         (Alpine, apk)"
                exit 0
                ;;
            *) err "Unbekanntes Argument: $1"; exit 1 ;;
        esac
    done
    # Normalisiere Debian-Variante
    if [[ "$OS_TYPE" != "debian" ]]; then
        DEBIAN_VARIANT="standard"
    fi
    if [[ "$DEBIAN_VARIANT" != "standard" && "$DEBIAN_VARIANT" != "minimal" ]]; then
        warn "Unbekannte DEBIAN_VARIANT=$DEBIAN_VARIANT - nutze standard"
        DEBIAN_VARIANT="standard"
    fi
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

    # whiptail optional nur fuer GUI
    if [[ "$GUI" == true ]] && ! command -v whiptail &>/dev/null; then
        warn "whiptail nicht installiert — installiere..."
        if command -v apt-get &>/dev/null; then
            apt-get update -qq && apt-get install -y -qq whiptail || true
        elif command -v apk &>/dev/null; then
            apk add --no-cache whiptail || true
        fi
        if command -v whiptail &>/dev/null; then log "whiptail installiert"; else warn "whiptail weiterhin nicht verfuegbar - fahre ohne GUI fort"; fi
    fi

    # Robustes Host-Dependency Handling: vor Installation pruefen, nachinstallieren, erneut pruefen
    # Muster: require_command git || install_git ; require_command git || fatal
    if ! command -v git &>/dev/null; then
        warn "git auf Host nicht gefunden - installiere..."
        if command -v apt-get &>/dev/null; then
            apt-get update -qq && apt-get install -y -qq git || true
        elif command -v apk &>/dev/null; then
            apk add --no-cache git || true
        fi
    fi
    if ! command -v git &>/dev/null; then
        fatal "Git installation failed - git auf Host nicht verfuegbar (Host-Check)"
    fi
    git --version >/dev/null 2>&1 || fatal "git --version auf Host fehlgeschlagen"
    log "git OK auf Host: $(git --version 2>&1 | head -n1)"

    if ! command -v curl &>/dev/null; then
        warn "curl auf Host nicht gefunden - installiere..."
        if command -v apt-get &>/dev/null; then apt-get update -qq && apt-get install -y -qq curl || true
        elif command -v apk &>/dev/null; then apk add --no-cache curl || true; fi
    fi
    if ! command -v curl &>/dev/null; then fatal "curl installation failed auf Host"; fi
    log "curl OK auf Host: $(curl --version 2>&1 | head -n1)"

    if ! command -v bash &>/dev/null; then
        warn "bash auf Host nicht gefunden - installiere..."
        if command -v apt-get &>/dev/null; then apt-get update -qq && apt-get install -y -qq bash || true
        elif command -v apk &>/dev/null; then apk add --no-cache bash || true; fi
    fi
    if ! command -v bash &>/dev/null; then fatal "bash installation failed auf Host"; fi
    log "bash OK auf Host: $(bash --version 2>&1 | head -n1)"

    # ca-certificates (Host)
    if ! test -f /etc/ssl/certs/ca-certificates.crt && ! test -f /etc/ssl/certs/ca-bundle.crt && ! dpkg -l ca-certificates 2>/dev/null | grep -q "^ii" && ! apk info 2>/dev/null | grep -q ca-certificates; then
        warn "ca-certificates auf Host nicht gefunden - installiere..."
        if command -v apt-get &>/dev/null; then apt-get update -qq && apt-get install -y -qq ca-certificates || true
        elif command -v apk &>/dev/null; then apk add --no-cache ca-certificates || true; fi
    fi
    if ! test -f /etc/ssl/certs/ca-certificates.crt && ! test -f /etc/ssl/certs/ca-bundle.crt && ! dpkg -l ca-certificates 2>/dev/null | grep -q "^ii" && ! apk info 2>/dev/null | grep -q ca-certificates; then
        fatal "ca-certificates installation failed auf Host"; fi
    log "ca-certificates OK auf Host"

    # Finale command -v Checks wie gefordert
    for _cmd in git curl bash; do
        if ! command -v "$_cmd" &>/dev/null; then fatal "command -v $_cmd auf Host fehlgeschlagen"; fi
    done
    log "Host-Dependencies OK (git/curl/ca-certificates/bash)" 

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
            15 70 3 \
            "alpine" "Alpine 3.20 (empfohlen, schlank)" ON \
            "debian" "Debian 12 Standard (stabil, offiz. Docker-Repo)" OFF \
            "debian-minimal" "Debian 12 Minimal (--no-install-recommends)" OFF \
            3>&1 1>&2 2>&3) || choice="alpine"
        case "$choice" in
            debian-minimal) OS_TYPE="debian"; DEBIAN_VARIANT="minimal" ;;
            debian)         OS_TYPE="debian"; DEBIAN_VARIANT="standard" ;;
            *)              OS_TYPE="$choice" ;;
        esac
        # Bei Debian Standard/Minimal zweite Abfrage falls direkt debian gewaehlt
        if [[ "$OS_TYPE" == "debian" && "$choice" == "debian" ]]; then
            local vchoice
            vchoice=$(whiptail --radiolist \
                "Debian-Variante waehlen:" \
                12 60 2 \
                "standard" "Standard (offizielles Docker-Repo, empfohlen)" ON \
                "minimal"  "Minimal (--no-install-recommends, schlank)" OFF \
                3>&1 1>&2 2>&3) || vchoice="standard"
            DEBIAN_VARIANT="$vchoice"
        fi
    fi

    if [[ "$OS_TYPE" == "debian" ]]; then
        log "OS: $OS_TYPE ($DEBIAN_VARIANT)"
    else
        log "OS: $OS_TYPE"
    fi
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

    local TEMPLATE_PREFIX=""
    if [[ "$OS_TYPE" == "debian" ]]; then
        TEMPLATE_PREFIX="debian-"
    else
        TEMPLATE_PREFIX="alpine-"
    fi

    # Template-Handling: pveam update (fehlertolerant)
    info "Aktualisiere Template-Liste..."
    pveam update 2>/dev/null || warn "pveam update hatte Fehler (nicht kritisch)"

    # Neuestes System-Template suchen (Turnkeylinux-Austräge ausschließen)
    info "Suche aktuellstes System-Template: ${TEMPLATE_PREFIX}*"
    local available_template
    available_template=$(pveam available 2>/dev/null \
        | awk '$1=="System" {print $2}' \
        | grep -E "^${TEMPLATE_PREFIX}[0-9]" \
        | sort -V \
        | tail -1 || true)

    if [[ -z "$available_template" ]]; then
        err "Kein ${TEMPLATE_PREFIX}*-System-Template verfügbar!"
        err "Verfügbare System-Templates:"
        pveam available 2>/dev/null | awk '$1=="System" {print $2}' | grep -E "^${TEMPLATE_PREFIX}" || true
        pveam available 2>/dev/null | awk '$1=="System" {print $2}' | head -5 || true
        exit 1
    fi
    log "Verwende Template: $available_template"

    # Prüfe ob Template lokal vorhanden
    if ! pveam list "$STORAGE" 2>/dev/null | grep -q "$available_template"; then
        info "Lade Template herunter: $available_template"
        pveam download "$STORAGE" "$available_template" || {
            err "Template-Download fehlgeschlagen!"
            exit 1
        }
        log "Template heruntergeladen: $available_template"
    else
        log "Template bereits vorhanden"
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
    info "Installiere Docker im Container (robuste Dependency-Pruefung)..."

    # ------------------------------------------------------------------
    # 1) Basis-Dependencies installieren (OS-spezifisch, sauber getrennt)
    # ------------------------------------------------------------------
    if [[ "$OS_TYPE" == "debian" ]]; then
        if [[ "${DEBIAN_VARIANT:-standard}" == "minimal" ]]; then
            info "Debian Minimal: installiere Basis-Dependencies (--no-install-recommends)..."
            pct exec "$CTID" -- bash -c "
                set -e
                export DEBIAN_FRONTEND=noninteractive
                apt-get update -qq
                apt-get install -y --no-install-recommends git curl ca-certificates bash gnupg
            "
        else
            info "Debian Standard: installiere Basis-Dependencies (offizielles Docker-Repo)..."
            pct exec "$CTID" -- bash -c "
                set -e
                export DEBIAN_FRONTEND=noninteractive
                apt-get update -qq
                apt-get install -y git curl ca-certificates bash gnupg
            "
        fi
    else
        info "Alpine: installiere Basis-Dependencies (apk)..."
        pct exec "$CTID" -- bash -c "
            set -e
            apk update
            apk add --no-cache git curl ca-certificates bash gnupg
            update-ca-certificates 2>/dev/null || true
        "
    fi

    # ------------------------------------------------------------------
    # 2) Nach Installation jede Dependency aktiv pruefen + Auto-Repair
    #    Vorgabe: command -v git / curl / bash, docker --version, docker compose version
    # ------------------------------------------------------------------
    info "Aktive Verifikation Basis-Dependencies im Container..."

    # git: require_command git || install_git ; require_command git || fatal
    if ! pct exec "$CTID" -- bash -c "command -v git >/dev/null 2>&1"; then
        warn "git im Container nicht gefunden - versuche Nachinstallation..."
        if [[ "$OS_TYPE" == "debian" ]]; then
            if [[ "${DEBIAN_VARIANT:-standard}" == "minimal" ]]; then
                pct exec "$CTID" -- bash -c "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y --no-install-recommends git" || true
            else
                pct exec "$CTID" -- bash -c "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y git" || true
            fi
        else
            pct exec "$CTID" -- bash -c "apk add --no-cache git" || true
        fi
    fi
    if ! pct exec "$CTID" -- bash -c "command -v git >/dev/null 2>&1"; then
        err "Git installation failed - git weiterhin nicht verfuegbar (command -v git fehlgeschlagen)"
        exit 1
    fi
    pct exec "$CTID" -- bash -c "git --version" || { err "git --version fehlgeschlagen"; exit 1; }
    log "git OK im Container: $(pct exec "$CTID" -- bash -c "git --version" 2>&1 | head -n1 || echo "unknown")"

    # curl
    if ! pct exec "$CTID" -- bash -c "command -v curl >/dev/null 2>&1"; then
        warn "curl im Container nicht gefunden - versuche Nachinstallation..."
        if [[ "$OS_TYPE" == "debian" ]]; then
            if [[ "${DEBIAN_VARIANT:-standard}" == "minimal" ]]; then
                pct exec "$CTID" -- bash -c "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y --no-install-recommends curl" || true
            else
                pct exec "$CTID" -- bash -c "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y curl" || true
            fi
        else
            pct exec "$CTID" -- bash -c "apk add --no-cache curl" || true
        fi
    fi
    if ! pct exec "$CTID" -- bash -c "command -v curl >/dev/null 2>&1"; then err "curl installation failed"; exit 1; fi
    pct exec "$CTID" -- bash -c "curl --version | head -n1"

    # ca-certificates
    if ! pct exec "$CTID" -- bash -c "test -f /etc/ssl/certs/ca-certificates.crt || test -f /etc/ssl/certs/ca-bundle.crt || dpkg -l ca-certificates 2>/dev/null | grep -q '^ii' || apk info 2>/dev/null | grep -q ca-certificates"; then
        warn "ca-certificates im Container nicht gefunden - versuche Nachinstallation..."
        if [[ "$OS_TYPE" == "debian" ]]; then
            if [[ "${DEBIAN_VARIANT:-standard}" == "minimal" ]]; then
                pct exec "$CTID" -- bash -c "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y --no-install-recommends ca-certificates" || true
            else
                pct exec "$CTID" -- bash -c "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y ca-certificates" || true
            fi
        else
            pct exec "$CTID" -- bash -c "apk add --no-cache ca-certificates; update-ca-certificates 2>/dev/null || true" || true
        fi
    fi
    if ! pct exec "$CTID" -- bash -c "test -f /etc/ssl/certs/ca-certificates.crt || test -f /etc/ssl/certs/ca-bundle.crt || dpkg -l ca-certificates 2>/dev/null | grep -q '^ii' || apk info 2>/dev/null | grep -q ca-certificates"; then
        err "ca-certificates installation failed"; exit 1; fi
    log "ca-certificates OK im Container"

    # bash
    if ! pct exec "$CTID" -- bash -c "command -v bash >/dev/null 2>&1"; then
        warn "bash im Container nicht gefunden - versuche Nachinstallation..."
        if [[ "$OS_TYPE" == "debian" ]]; then
            if [[ "${DEBIAN_VARIANT:-standard}" == "minimal" ]]; then
                pct exec "$CTID" -- bash -c "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y --no-install-recommends bash" || true
            else
                pct exec "$CTID" -- bash -c "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y bash" || true
            fi
        else
            pct exec "$CTID" -- bash -c "apk add --no-cache bash" || true
        fi
    fi
    if ! pct exec "$CTID" -- bash -c "command -v bash >/dev/null 2>&1"; then err "bash installation failed"; exit 1; fi
    pct exec "$CTID" -- bash -c "bash --version | head -n1"

    # explizite Checks wie gefordert
    pct exec "$CTID" -- bash -c "command -v git && command -v curl && command -v bash && echo '[OK] command -v Checks bestanden'" || { err "command -v Verifikation fehlgeschlagen"; exit 1; }

    # ------------------------------------------------------------------
    # 3) Docker installieren (OS-spezifisch) - erst nach Basis-Validierung
    # ------------------------------------------------------------------
    info "Installiere Docker im Container..."
    if [[ "$OS_TYPE" == "debian" ]]; then
        if [[ "${DEBIAN_VARIANT:-standard}" == "minimal" ]]; then
            pct exec "$CTID" -- bash -c "
                set -e
                export DEBIAN_FRONTEND=noninteractive
                apt-get update -qq
                apt-get install -y --no-install-recommends docker.io docker-compose ca-certificates curl || true
                apt-get install -y --no-install-recommends docker-compose-plugin 2>/dev/null || true
                if command -v systemctl >/dev/null 2>&1; then systemctl enable docker 2>/dev/null || true; systemctl start docker 2>/dev/null || true; fi
                if ! docker info >/dev/null 2>&1; then dockerd >/dev/null 2>&1 & sleep 3; fi
            "
        else
            pct exec "$CTID" -- bash -c "
                set -e
                export DEBIAN_FRONTEND=noninteractive
                apt-get update -qq
                apt-get install -y ca-certificates curl gnupg
                install -m 0755 -d /etc/apt/keyrings
                curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
                chmod a+r /etc/apt/keyrings/docker.gpg
                echo \"deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \$(. /etc/os-release && echo \$VERSION_CODENAME) stable\" > /etc/apt/sources.list.d/docker.list
                apt-get update -qq
                apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
                if command -v systemctl >/dev/null 2>&1; then systemctl enable docker 2>/dev/null || true; systemctl start docker 2>/dev/null || true; fi
                if ! docker info >/dev/null 2>&1; then dockerd >/dev/null 2>&1 & sleep 3; fi
            "
        fi
    else
        pct exec "$CTID" -- bash -c "
            set -e
            apk update
            apk add --no-cache docker docker-compose ca-certificates curl bash
            apk add --no-cache docker-cli-compose 2>/dev/null || true
            if command -v rc-update >/dev/null 2>&1; then rc-update add docker boot 2>/dev/null || true; service docker start 2>/dev/null || true; fi
            if ! docker info >/dev/null 2>&1; then dockerd >/dev/null 2>&1 & sleep 3; fi
        "
    fi
    log "Docker Installation abgeschlossen - verifiziere..."

    # ------------------------------------------------------------------
    # 4) Docker aktiv pruefen: command -v docker, docker --version, docker compose version
    # ------------------------------------------------------------------
    if ! pct exec "$CTID" -- bash -c "command -v docker >/dev/null 2>&1"; then err "docker installation failed - command -v docker fehlgeschlagen"; exit 1; fi
    pct exec "$CTID" -- bash -c "docker --version" || { err "docker --version fehlgeschlagen"; exit 1; }
    if ! pct exec "$CTID" -- bash -c "docker compose version >/dev/null 2>&1 || docker-compose version >/dev/null 2>&1"; then
        warn "docker compose nicht gefunden - versuche Nachinstallation..."
        if [[ "$OS_TYPE" == "debian" ]]; then
            if [[ "${DEBIAN_VARIANT:-standard}" == "minimal" ]]; then
                pct exec "$CTID" -- bash -c "export DEBIAN_FRONTEND=noninteractive; apt-get install -y --no-install-recommends docker-compose-plugin docker-compose 2>/dev/null || true" || true
            else
                pct exec "$CTID" -- bash -c "export DEBIAN_FRONTEND=noninteractive; apt-get install -y docker-compose-plugin 2>/dev/null || true" || true
            fi
        else
            pct exec "$CTID" -- bash -c "apk add --no-cache docker-cli-compose docker-compose 2>/dev/null || true" || true
        fi
    fi
    if ! pct exec "$CTID" -- bash -c "docker compose version >/dev/null 2>&1 || docker-compose version >/dev/null 2>&1"; then err "docker compose installation failed"; exit 1; fi
    pct exec "$CTID" -- bash -c "docker compose version 2>&1 | head -n1 || docker-compose version 2>&1 | head -n1"

    # ------------------------------------------------------------------
    # 5) Repository erst nach erfolgreicher Git-Pruefung klonen
    #    Muster: require_command git || install_git ; require_command git || fatal ; git clone
    # ------------------------------------------------------------------
    info "Klone WaWi-Repo (nur nach Git-Validierung)..."
    if ! pct exec "$CTID" -- bash -c "command -v git >/dev/null 2>&1"; then
        warn "git vor Clone nicht verfuegbar - versuche Installation..."
        if [[ "$OS_TYPE" == "debian" ]]; then
            if [[ "${DEBIAN_VARIANT:-standard}" == "minimal" ]]; then
                pct exec "$CTID" -- bash -c "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y --no-install-recommends git" || true
            else
                pct exec "$CTID" -- bash -c "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y git" || true
            fi
        else
            pct exec "$CTID" -- bash -c "apk add --no-cache git" || true
        fi
    fi
    if ! pct exec "$CTID" -- bash -c "command -v git >/dev/null 2>&1"; then err "Git installation failed - Clone abgebrochen"; exit 1; fi
    pct exec "$CTID" -- bash -c "git --version >/dev/null 2>&1" || { err "git --version fehlgeschlagen vor Clone"; exit 1; }
    pct exec "$CTID" -- bash -c "
        set -e
        rm -rf $INSTALL_DIR
        git clone $REPO_URL $INSTALL_DIR
    " || { err "git clone fehlgeschlagen"; exit 1; }
    log "Repo geklont nach $INSTALL_DIR"

    # .env generieren
    generate_env

    # ------------------------------------------------------------------
    # 6) Docker erst nach erfolgreicher Pruefung verwenden
    # ------------------------------------------------------------------
    info "Baue und starte Container (nur nach Docker-Validierung)..."
    if ! pct exec "$CTID" -- bash -c "command -v docker >/dev/null 2>&1 && (docker compose version >/dev/null 2>&1 || docker-compose version >/dev/null 2>&1)"; then
        err "Docker nicht verfuegbar fuer Compose (validierung fehlgeschlagen)"; exit 1; fi
    pct exec "$CTID" -- bash -c "
        set -e
        cd $INSTALL_DIR
        WEB_PORT=$WEB_PORT docker compose up -d --build
    " || { err "docker compose up fehlgeschlagen"; exit 1; }
    log "Docker Compose gestartet"

    # ------------------------------------------------------------------
    # 7) Finale Validierung im Container
    # ------------------------------------------------------------------
    info "Finale validate_environment im Container (OS=$OS_TYPE MODE=docker)..."
    # Versuche lib/common.sh im Container zu nutzen falls gepusht, sonst inline validierung
    pct exec "$CTID" -- bash -c "
        set -e
        echo '[*] command -v git: ' \$(command -v git)
        git --version
        echo '[*] command -v curl: ' \$(command -v curl)
        curl --version | head -n1
        echo '[*] command -v bash: ' \$(command -v bash)
        bash --version | head -n1
        docker --version
        docker compose version 2>&1 | head -n1 || docker-compose version 2>&1 | head -n1
        echo '[OK] Final validate_environment bestanden'
    " || { err "Finale Validierung im Container fehlgeschlagen"; exit 1; }
}

deploy_nativ() {
    info "Installiere Node.js im Container (robuste Dependency-Pruefung)..."

    # ------------------------------------------------------------------
    # 1) Basis-Dependencies (OS-spezifisch) - identisch zu deploy_docker
    # ------------------------------------------------------------------
    if [[ "$OS_TYPE" == "debian" ]]; then
        if [[ "${DEBIAN_VARIANT:-standard}" == "minimal" ]]; then
            info "Debian Minimal: installiere Basis-Dependencies (--no-install-recommends)..."
            pct exec "$CTID" -- bash -c "
                set -e
                export DEBIAN_FRONTEND=noninteractive
                apt-get update -qq
                apt-get install -y --no-install-recommends git curl ca-certificates bash
            "
        else
            info "Debian Standard: installiere Basis-Dependencies..."
            pct exec "$CTID" -- bash -c "
                set -e
                export DEBIAN_FRONTEND=noninteractive
                apt-get update -qq
                apt-get install -y git curl ca-certificates bash gnupg
            "
        fi
    else
        info "Alpine: installiere Basis-Dependencies (apk)..."
        pct exec "$CTID" -- bash -c "
            set -e
            apk update
            apk add --no-cache git curl ca-certificates bash
            update-ca-certificates 2>/dev/null || true
        "
    fi

    # 2) Aktive Verifikation (wie deploy_docker)
    info "Aktive Verifikation Basis-Dependencies im Container..."
    if ! pct exec "$CTID" -- bash -c "command -v git >/dev/null 2>&1"; then
        warn "git im Container nicht gefunden - versuche Nachinstallation..."
        if [[ "$OS_TYPE" == "debian" ]]; then
            if [[ "${DEBIAN_VARIANT:-standard}" == "minimal" ]]; then
                pct exec "$CTID" -- bash -c "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y --no-install-recommends git" || true
            else
                pct exec "$CTID" -- bash -c "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y git" || true
            fi
        else
            pct exec "$CTID" -- bash -c "apk add --no-cache git" || true
        fi
    fi
    if ! pct exec "$CTID" -- bash -c "command -v git >/dev/null 2>&1"; then err "Git installation failed - git weiterhin nicht verfuegbar"; exit 1; fi
    pct exec "$CTID" -- bash -c "git --version" || { err "git --version fehlgeschlagen"; exit 1; }
    if ! pct exec "$CTID" -- bash -c "command -v curl >/dev/null 2>&1"; then
        if [[ "$OS_TYPE" == "debian" ]]; then
            if [[ "${DEBIAN_VARIANT:-standard}" == "minimal" ]]; then
                pct exec "$CTID" -- bash -c "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y --no-install-recommends curl" || true
            else
                pct exec "$CTID" -- bash -c "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y curl" || true
            fi
        else pct exec "$CTID" -- bash -c "apk add --no-cache curl" || true; fi
    fi
    if ! pct exec "$CTID" -- bash -c "command -v curl >/dev/null 2>&1"; then err "curl installation failed"; exit 1; fi
    if ! pct exec "$CTID" -- bash -c "command -v bash >/dev/null 2>&1"; then
        if [[ "$OS_TYPE" == "debian" ]]; then
            if [[ "${DEBIAN_VARIANT:-standard}" == "minimal" ]]; then
                pct exec "$CTID" -- bash -c "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y --no-install-recommends bash" || true
            else
                pct exec "$CTID" -- bash -c "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y bash" || true
            fi
        else pct exec "$CTID" -- bash -c "apk add --no-cache bash" || true; fi
    fi
    if ! pct exec "$CTID" -- bash -c "command -v bash >/dev/null 2>&1"; then err "bash installation failed"; exit 1; fi
    pct exec "$CTID" -- bash -c "command -v git && command -v curl && command -v bash && echo '[OK] command -v Checks bestanden'" || { err "command -v Verifikation fehlgeschlagen"; exit 1; }

    # ------------------------------------------------------------------
    # 3) Node.js installieren (OS-spezifisch)
    # ------------------------------------------------------------------
    info "Installiere Node.js im Container..."
    if [[ "$OS_TYPE" == "debian" ]]; then
        pct exec "$CTID" -- bash -c "
            set -e
            export DEBIAN_FRONTEND=noninteractive
            apt-get update -qq
            apt-get install -y --no-install-recommends curl ca-certificates gnupg 2>/dev/null || apt-get install -y curl ca-certificates gnupg
            curl -fsSL https://deb.nodesource.com/setup_26.x | bash -
            apt-get install -y nodejs
            node --version
            npm --version
        " || { err "Node.js Installation (Debian) fehlgeschlagen"; exit 1; }
    else
        # Alpine: Node direkt vom Hersteller
        pct exec "$CTID" -- bash -c "
            set -e
            apk add --no-cache curl git python3 make g++ bash
            # Versuche apk nodejs zuerst (schlanker)
            if apk add --no-cache nodejs npm 2>/dev/null; then
                echo '[i] nodejs via apk installiert'
            else
                NODE_VERSION=\$(curl -s https://nodejs.org/dist/index.json | grep -o '"version":"v[^"]*"' | head -1 | cut -d'"' -f4 | tr -d 'v')
                if [ -z \"\$NODE_VERSION\" ]; then NODE_VERSION=\"22.14.0\"; fi
                echo \"[i] Lade Node v\$NODE_VERSION (musl)...\"
                curl -fsSL \"https://nodejs.org/dist/v\${NODE_VERSION}/node-v\${NODE_VERSION}-linux-x64-musl.tar.xz\" -o /tmp/node.tar.xz
                tar -xf /tmp/node.tar.xz -C /usr/local --strip-components=1
                rm /tmp/node.tar.xz
            fi
            node --version
            npm --version
        " || { err "Node.js Installation (Alpine) fehlgeschlagen"; exit 1; }
    fi
    log "Node.js installiert"

    # ------------------------------------------------------------------
    # 4) Git klonen - erst nach Git-Validierung
    # ------------------------------------------------------------------
    info "Klone WaWi-Repo (nur nach Git-Validierung)..."
    if ! pct exec "$CTID" -- bash -c "command -v git >/dev/null 2>&1"; then
        warn "git vor Clone nicht verfuegbar - versuche Installation..."
        if [[ "$OS_TYPE" == "debian" ]]; then
            if [[ "${DEBIAN_VARIANT:-standard}" == "minimal" ]]; then
                pct exec "$CTID" -- bash -c "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y --no-install-recommends git" || true
            else
                pct exec "$CTID" -- bash -c "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y git" || true
            fi
        else
            pct exec "$CTID" -- bash -c "apk add --no-cache git" || true
        fi
    fi
    if ! pct exec "$CTID" -- bash -c "command -v git >/dev/null 2>&1"; then err "Git installation failed - Clone abgebrochen"; exit 1; fi
    pct exec "$CTID" -- bash -c "git --version >/dev/null 2>&1" || { err "git --version fehlgeschlagen vor Clone"; exit 1; }
    pct exec "$CTID" -- bash -c "
        set -e
        rm -rf $INSTALL_DIR
        git clone $REPO_URL $INSTALL_DIR
    " || { err "git clone fehlgeschlagen"; exit 1; }
    log "Repo geklont"

    # .env generieren
    generate_env

    # Dependencies installieren & bauen - erst nach Clone
    info "Installiere Dependencies & baue..."
    pct exec "$CTID" -- bash -c "
        set -e
        cd $INSTALL_DIR
        npm ci --ignore-scripts
        npm run build --workspace=@wawi/api 2>/dev/null || npm run build --workspaces --if-present
        npm run build --workspace=@wawi/web 2>/dev/null || true
    " || { err "Build fehlgeschlagen"; exit 1; }
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
        " || { err "OpenRC wawi-api Start fehlgeschlagen"; exit 1; }
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
        " || { err "systemd wawi-api Start fehlgeschlagen"; exit 1; }
    fi
    log "API-Service gestartet"

    # Web: nginx + static build
    if [[ "$OS_TYPE" == "alpine" ]]; then
        pct exec "$CTID" -- bash -c "
            set -e
            apk add --no-cache nginx
            mkdir -p /var/www/localhost/htdocs
            cp -r $INSTALL_DIR/apps/web/dist/* /var/www/localhost/htdocs/ 2>/dev/null || cp -r $INSTALL_DIR/apps/web/dist/* /usr/share/nginx/html/ 2>/dev/null || true
            rc-update add nginx default 2>/dev/null || true
            service nginx start 2>/dev/null || nginx
        " || warn "nginx Start (Alpine) fehlgeschlagen - pruefe manuell"
    else
        pct exec "$CTID" -- bash -c "
            set -e
            export DEBIAN_FRONTEND=noninteractive
            apt-get install -y nginx
            mkdir -p /var/www/html
            cp -r $INSTALL_DIR/apps/web/dist/* /var/www/html/ 2>/dev/null || true
            systemctl enable nginx 2>/dev/null || true
            systemctl restart nginx 2>/dev/null || service nginx start 2>/dev/null || nginx
        " || warn "nginx Start (Debian) fehlgeschlagen - pruefe manuell"
    fi
    log "Web-Server gestartet"

    # Finale Validierung nativ
    pct exec "$CTID" -- bash -c "
        command -v git && git --version
        command -v curl && curl --version | head -n1
        command -v bash && bash --version | head -n1
        command -v node && node --version
        npm --version
        echo '[OK] deploy_nativ finale Validierung bestanden'
    " || { err "Finale nativ Validierung fehlgeschlagen"; exit 1; }
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
