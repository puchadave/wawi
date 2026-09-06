#!/usr/bin/env bash
# ============================================================================
# WaWi PVE Helper-Script v2.4
# Automatische LXC-Installation der WaWi Middleware & Swarm Cluster Node
#
# Features:
#   - Docker Compose (Standalone)
#   - Alpine/Debian Docker SWARM Cluster Node (Manager / Worker)
#   - Integrierter Portainer-Agent (auf allen Nodes)
#   - Nativer Node.js Betrieb
# ============================================================================
set -euo pipefail

# ============================================================================
# Defaults
# ============================================================================
CTID=301
OS_TYPE="alpine"
DEPLOY_MODE="swarm"  # swarm | docker | nativ
SWARM_ROLE="manager" # manager | worker
SWARM_MANAGER_IP=""
SWARM_JOIN_TOKEN=""
INSTALL_PORTAINER_AGENT=true

WEB_PORT=5173
API_PORT=8080
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
DEBIAN_VARIANT="standard"

# Secrets Defaults
SHOPWARE_BASE_URL="https://uptempo.pucha.dev"
SHOPWARE_CLIENT_ID=""
SHOPWARE_CLIENT_SECRET=""
SHOPWARE_TAX_ID=""
DATABASE_URL="postgresql://wawi:***@localhost:5432/wawi_db"
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
NC='\033[0m'

log()   { echo -e "${GREEN}[✓]${NC} $*" ; }
warn()  { echo -e "${YELLOW}[!]${NC} $*" ; }
err()   { echo -e "${RED}[✗]${NC} $*" >&2 ; }
info()  { echo -e "${BLUE}[i]${NC} $*" ; }
header(){ echo -e "\n${CYAN}=== $* ===${NC}\n" ; }

# ============================================================================
# CLI-Argumente parsen
# ============================================================================
parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --ctid)        CTID="$2"; shift 2 ;;
            --os)          OS_TYPE="$2"; shift 2 ;;
            --mode)        DEPLOY_MODE="$2"; shift 2 ;;
            --swarm-role)  SWARM_ROLE="$2"; shift 2 ;;
            --swarm-ip)    SWARM_MANAGER_IP="$2"; shift 2 ;;
            --swarm-token) SWARM_JOIN_TOKEN="$2"; shift 2 ;;
            --portainer)   INSTALL_PORTAINER_AGENT=true; shift ;;
            --no-gui)      GUI=false; shift ;;
            --quiet)       QUIET=true; shift ;;
            --dry-run)     DRY_RUN=true; shift ;;
            --secrets-dir) SECRETS_DIR="$2"; shift 2 ;;
            --help|-h)
                echo "Verwendung: bash wawi.sh [Optionen]"
                echo "  --mode <swarm|docker|nativ>    Installationsmodus (Default: swarm)"
                echo "  --swarm-role <manager|worker>  Swarm Node Rolle"
                echo "  --swarm-ip <ip>                Manager IP bei Worker Join"
                echo "  --swarm-token <token>          Swarm Join Token"
                echo "  --os <alpine|debian>           Basis-OS (Default: alpine)"
                echo "  --ctid <id>                    Container-ID (Default: 301)"
                echo "  --no-gui                       Headless Modus"
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
    log "Storage-Manager OK"
}

# ============================================================================
# Menüs (Whiptail GUI)
# ============================================================================
select_mode() {
    header "Installationsmodus wählen"

    if [[ "$GUI" == true ]]; then
        local choice
        choice=$(whiptail --radiolist \
            "Installationsmodus & Cluster-Architektur:" \
            16 70 3 \
            "swarm"  "Docker SWARM Cluster (Alpine HA, Multi-Node, Portainer-Agent)" ON \
            "docker" "Docker Compose (Standalone Einzelinstanz)" OFF \
            "nativ"  "Nativ Node.js (Ohne Container)" OFF \
            3>&1 1>&2 2>&3) || choice="swarm"
        DEPLOY_MODE="$choice"
    fi

    log "Modus: $DEPLOY_MODE"
}

select_swarm_config() {
    if [[ "$DEPLOY_MODE" != "swarm" ]]; then return 0; fi

    header "Docker Swarm & Portainer Konfiguration"

    if [[ "$GUI" == true ]]; then
        local rchoice
        rchoice=$(whiptail --radiolist \
            "Rolle dieser Node im Swarm-Cluster:" \
            14 65 2 \
            "manager" "Primary Swarm Manager (Stack & Cluster initialisieren)" ON \
            "worker"  "Swarm Worker (Bestehendem Cluster beitreten)" OFF \
            3>&1 1>&2 2>&3) || rchoice="manager"
        SWARM_ROLE="$rchoice"

        if [[ "$SWARM_ROLE" == "worker" ]]; then
            SWARM_MANAGER_IP=$(whiptail --inputbox "Manager Node IP-Adresse (z.B. 192.168.176.13):" 10 60 "$SWARM_MANAGER_IP" 3>&1 1>&2 2>&3) || true
            SWARM_JOIN_TOKEN=$(whiptail --inputbox "Swarm Worker Join-Token (aus 'docker swarm join-token worker'):" 10 60 "$SWARM_JOIN_TOKEN" 3>&1 1>&2 2>&3) || true
        fi
    fi

    log "Swarm Rolle: $SWARM_ROLE"
    if [[ "$SWARM_ROLE" == "worker" ]]; then
        log "Swarm Manager IP: $SWARM_MANAGER_IP"
    fi
}

select_os() {
    header "Betriebssystem wählen"

    if [[ "$GUI" == true ]]; then
        local choice
        choice=$(whiptail --radiolist \
            "Basis-Betriebssystem für den LXC Container:" \
            14 65 2 \
            "alpine" "Alpine Linux 3.20 (Ultraschlank, extrem schnell, empfohlen)" ON \
            "debian" "Debian 12 Bookworm (Standard Linux)" OFF \
            3>&1 1>&2 2>&3) || choice="alpine"
        OS_TYPE="$choice"
    fi

    log "Basis-OS: $OS_TYPE"
}

select_specs() {
    header "Container-Ressourcen"

    if [[ "$GUI" == true ]]; then
        CTID=$(whiptail --inputbox "Container ID (CTID):" 10 50 "$CTID" 3>&1 1>&2 2>&3) || CTID=301
        RAM=$(whiptail --inputbox "Arbeitsspeicher in MB (RAM):" 10 50 "$RAM" 3>&1 1>&2 2>&3) || RAM=2048
        CPU=$(whiptail --inputbox "CPU Cores:" 10 50 "$CPU" 3>&1 1>&2 2>&3) || CPU=2
        DISK=$(whiptail --inputbox "Festplattengröße in GB (Disk):" 10 50 "$DISK" 3>&1 1>&2 2>&3) || DISK=8
    fi

    log "CTID: $CTID | RAM: ${RAM}MB | CPU: ${CPU} Kerne | Disk: ${DISK}GB"
}

# ============================================================================
# LXC Container Erstellung
# ============================================================================
create_lxc() {
    header "LXC Container $CTID erstellen"

    if [[ "$DRY_RUN" == true ]]; then
        info "DRY-RUN: Überspringe Container-Erstellung"
        return 0
    fi

    local STORAGE="local-lvm"
    if ! pvesm status 2>/dev/null | awk '{print $1}' | grep -qx "local-lvm"; then
        STORAGE="local"
    fi

    # Template download
    local TEMPLATE="alpine-3.20-default"
    if [[ "$OS_TYPE" == "debian" ]]; then
        TEMPLATE="debian-12-standard"
    fi

    pveam update >/dev/null 2>&1 || true
    local FULL_TMPL
    FULL_TMPL=$(pveam available -section system | awk -v pat="$TEMPLATE" '$2 ~ pat {print $2}' | sort -V | tail -n 1 || true)
    
    if [[ -z "$FULL_TMPL" ]]; then
        FULL_TMPL="$TEMPLATE"
    fi

    if ! pveam list local 2>/dev/null | grep -q "$TEMPLATE"; then
        info "Lade Template $FULL_TMPL herunter..."
        pveam download local "$FULL_TMPL" || true
    fi

    local ACTUAL_TMPL
    ACTUAL_TMPL=$(pvesm list local --content vztmpl 2>/dev/null | awk -v pat="$TEMPLATE" '$1 ~ pat {print $1}' | tail -n 1)

    info "Erstelle LXC $CTID mit $ACTUAL_TMPL..."
    pct create "$CTID" "$ACTUAL_TMPL" \
        --hostname "wawi-node-$CTID" \
        --memory "$RAM" \
        --cores "$CPU" \
        --rootfs "${STORAGE}:${DISK}" \
        --net0 "name=eth0,bridge=vmbr0,ip=dhcp" \
        --ostype "$OS_TYPE" \
        --unprivileged 1 \
        --features "nesting=1,keyctl=1" \
        --onboot 1 \
        --description "WaWi Middleware & Swarm Cluster Node"

    pct start "$CTID"
    info "Warte auf Container Start..."
    for i in $(seq 1 30); do
        if pct exec "$CTID" -- true 2>/dev/null; then break; fi
        sleep 1
    done
    log "Container $CTID erfolgreich gebootet."
}

# ============================================================================
# Deployment im Container (Swarm & Portainer-Agent)
# ============================================================================
deploy_swarm_and_agent() {
    header "Docker SWARM & Portainer-Agent einrichten"

    info "Installiere Docker & Tools in Container $CTID ($OS_TYPE)..."
    if [[ "$OS_TYPE" == "alpine" ]]; then
        pct exec "$CTID" -- /bin/sh -c "apk update && apk add --no-cache docker docker-cli-compose git curl nodejs npm ca-certificates"
        pct exec "$CTID" -- rc-update add docker boot
        pct exec "$CTID" -- service docker start
    else
        pct exec "$CTID" -- /bin/bash -c "apt-get update && apt-get install -y docker.io docker-compose-v2 git curl nodejs npm ca-certificates && systemctl enable --now docker"
    fi

    # 1. Swarm Init oder Join
    if [[ "$SWARM_ROLE" == "manager" ]]; then
        info "Initialisiere Docker Swarm Manager..."
        pct exec "$CTID" -- /bin/sh -c "docker swarm init || true"
        log "Docker Swarm Manager aktiv."
        
        # Swarm Overlay Network anlegen
        pct exec "$CTID" -- /bin/sh -c "docker network create --driver overlay --attachable wawi-overlay || true"
        pct exec "$CTID" -- /bin/sh -c "docker network create --driver overlay --attachable agent_network || true"

        # 2. Portainer Agent als Global Swarm Service installieren
        info "Deploye Portainer Agent (Global Swarm Service auf Port 9001)..."
        pct exec "$CTID" -- /bin/sh -c "docker service create \
            --name portainer_agent \
            --network agent_network \
            --publish mode=host,target=9001,published=9001 \
            -e AGENT_CLUSTER_ADDR=tasks.portainer_agent \
            --mode global \
            --mount type=bind,src=//var/run/docker.sock,dst=//var/run/docker.sock \
            --mount type=bind,src=//var/lib/docker/volumes,dst=//var/lib/docker/volumes \
            portainer/agent:latest || true"

        # 3. WaWi Stack klonen und deployen
        info "Klone WaWi Repository und deploye Swarm Stack..."
        pct exec "$CTID" -- /bin/sh -c "rm -rf /opt/wawi && git clone $REPO_URL /opt/wawi"
        pct exec "$CTID" -- /bin/sh -c "cd /opt/wawi && docker build -t puchadave/wawi-middleware:latest . && docker stack deploy -c docker-compose.swarm.yml wawi"

    else
        # Worker Node Join
        if [[ -n "$SWARM_MANAGER_IP" && -n "$SWARM_JOIN_TOKEN" ]]; then
            info "Trete Swarm Cluster bei ($SWARM_MANAGER_IP)..."
            pct exec "$CTID" -- /bin/sh -c "docker swarm join --token $SWARM_JOIN_TOKEN $SWARM_MANAGER_IP:2377"
            log "Erfolgreich als Swarm Worker beigetreten!"
        else
            warn "Keine Swarm Manager IP/Token übergeben — manueller Join nötig:"
            warn "pct exec $CTID -- docker swarm join --token <TOKEN> <MANAGER-IP>:2377"
        fi
    fi

    # Container IP ermitteln
    local IP=""
    for i in $(seq 1 15); do
        IP="$(pct exec "$CTID" -- ip -4 addr show eth0 2>/dev/null | grep -o 'inet [0-9.]*' | awk '{print $2}' || true)"
        [[ -n "$IP" ]] && break
        sleep 1
    done

    echo ""
    echo "================================================================"
    echo "  WaWi Swarm Cluster Node $CTID — ERFOLGREICH BEREITGESTELLT!"
    echo "================================================================"
    echo "  Node Rolle:       $SWARM_ROLE"
    echo "  Container-IP:     ${IP:-DHCP}"
    echo "  Portainer Agent:  http://${IP:-<IP>}:9001 (Agent Port)"
    if [[ "$SWARM_ROLE" == "manager" ]]; then
        echo "  WaWi Middleware:  http://${IP:-<IP>}:8080/api/health"
        echo "  Admin Leitstand:  http://${IP:-<IP>}:8080/admin.html"
        echo "  Google Feed:      http://${IP:-<IP>}:8080/api/channels/google-shopping.xml"
    fi
    echo "================================================================"
}

deploy_standalone_docker() {
    header "Docker Compose Standalone einrichten"

    info "Installiere Docker in Container $CTID..."
    if [[ "$OS_TYPE" == "alpine" ]]; then
        pct exec "$CTID" -- /bin/sh -c "apk update && apk add --no-cache docker docker-cli-compose git curl nodejs npm ca-certificates"
        pct exec "$CTID" -- rc-update add docker boot
        pct exec "$CTID" -- service docker start
    else
        pct exec "$CTID" -- /bin/bash -c "apt-get update && apt-get install -y docker.io docker-compose-v2 git curl nodejs npm ca-certificates && systemctl enable --now docker"
    fi

    # Portainer Agent Standalone starten
    info "Starte Portainer Agent Container (Port 9001)..."
    pct exec "$CTID" -- /bin/sh -c "docker run -d -p 9001:9001 --name portainer_agent --restart=always -v /var/run/docker.sock:/var/run/docker.sock -v /var/lib/docker/volumes:/var/lib/docker/volumes portainer/agent:latest || true"

    info "Klone WaWi Repository und starte Docker Compose..."
    pct exec "$CTID" -- /bin/sh -c "rm -rf /opt/wawi && git clone $REPO_URL /opt/wawi && cd /opt/wawi && docker compose up -d --build"

    log "Docker Compose Stack aktiv."
}

# ============================================================================
# Main Execution
# ============================================================================
main() {
    parse_args "$@"
    check_host
    select_mode
    select_swarm_config
    select_os
    select_specs
    create_lxc

    if [[ "$DEPLOY_MODE" == "swarm" ]]; then
        deploy_swarm_and_agent
    elif [[ "$DEPLOY_MODE" == "docker" ]]; then
        deploy_standalone_docker
    else
        info "Nativer Modus ausgewählt..."
        pct exec "$CTID" -- /bin/sh -c "rm -rf /opt/wawi && git clone $REPO_URL /opt/wawi && cd /opt/wawi/shop-kern && node server.js 8080 &"
    fi
}

main "$@"
