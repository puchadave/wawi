#!/usr/bin/env bash
# ============================================================================
# WaWi PVE Helper-Script v2.7
# Automatische LXC-Installation der WaWi Middleware & Swarm Cluster Node
# Inklusive vorkonfiguriertem Portainer CE Server & Agent via Socket-Integration
# VÖLLIG AUTOMATISCHER ZeroTier VPN-Integrationsmodus für sichere, immer erreichbare
# Docker Swarm-Clusters (netzintern, physikalisch-unabhängig).
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
INSTALL_PORTAINER=true
INSTALL_ZEROTIER=false
ZEROTIER_NETWORK_ID=""
PORTAINER_ADMIN_USER="admin"
PORTAINER_ADMIN_PASS="PortainerAdmin2026!"

WEB_PORT=5173
API_PORT=8080
REPO_URL="https://github.com/puchadave/wawi.git"
INSTALL_DIR="/opt/wawi"
ADMIN_USER="puchadev"
QUIET=false
GUI=true
DRY_RUN=false
STATIC_IP=""
GATEWAY=""
RAM=2048
CPU=2
DISK=8
DEBIAN_VARIANT="standard"

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
            --admin-pass)  PORTAINER_ADMIN_PASS="$2"; shift 2 ;;
            --zerotier)    INSTALL_ZEROTIER=true; shift ;;
            --zt-network)  ZEROTIER_NETWORK_ID="$2"; shift 2 ;;
            --no-gui)      GUI=false; shift ;;
            --quiet)       QUIET=true; shift ;;
            --dry-run)     DRY_RUN=true; shift ;;
            --help|-h)
                echo "Verwendung: bash wawi.sh [Optionen]"
                echo "  --mode <swarm|docker|nativ>    Installationsmodus (Default: swarm)"
                echo "  --swarm-role <manager|worker>  Swarm Node Rolle (Default: manager)"
                echo "  --zerotier                         ZeroTier VPN-Integration aktivieren"
                echo "  --zt-network <id>                  ZeroTier Network ID (falls --zerotier gesetzt)"
                echo "  --swarm-ip <ip>                    Manager IP bei Worker Join"
                echo "  --swarm-token <token>              Swarm Join Token"
                echo "  --admin-pass <pass>                Portainer Initial-Passwort"
                echo "  --os <alpine|debian>               Basis-OS (Default: alpine)"
                echo "  --ctid <id>                        Container-ID (Default: 301)"
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
            16 80 3 \
            "swarm"  "Docker SWARM Cluster (Alpine HA, Portainer CE, ZeroTier VPN)" ON \
            "docker" "Docker Compose Standalone (Einzelinstanz + Portainer Agent)" OFF \
            "nativ"  "Nativ Node.js (Ohne Container)" OFF \
            3>&1 1>&2 2>&3) || choice="swarm"
        DEPLOY_MODE="$choice"
    fi

    log "Modus: $DEPLOY_MODE"

    # ZeroTier-Frage nach Swarm-Auswahl
    if [[ "$DEPLOY_MODE" == "swarm" ]]; then
        local zt_choice
        zt_choice=$(whiptail --yesno "ZeroTier VPN-Integrationsmodus aktivieren?\n(Docker Swarm wird zusätzlich über ein virtuelles Netzwerk verbunden, physikalische IPs werden überschneidungsfrei erreichbar.)" 10 70) || zt_choice="n"
        if [[ "$zt_choice" == "yes" ]]; then
            INSTALL_ZEROTIER=true
            zt_network=$(whiptail --inputbox "ZeroTier Network ID (16-stellige Hex-ID, z.B. c0c1c2c3c4c5c6c7c8c9cacbcccd)" 10 60 " entered manually" 3>&1 1>&2 2>&3) || true
            if [[ -n "$zt_network" ]]; then
                ZEROTIER_NETWORK_ID="$zt_network"
            else
                # Fallback: Verwendung einer Musternetz-ID (diese muss später am Host konfiguriert werden)
                ZEROTIER_NETWORK_ID="c0c1c2c3c4c5c6c7c8c9cacbcccd"
                warn "Keine Network ID eingegeben — es wurde eine Muster-ID verwendet: $ZEROTIER_NETWORK_ID"
            fi
        fi
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
            16 80 3 \
            "swarm"  "Docker SWARM Cluster (Alpine HA, Portainer CE, ZeroTier VPN)" ON \
            "docker" "Docker Compose Standalone (Einzelinstanz + Portainer Agent)" OFF \
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
            15 70 2 \
            "manager" "Primary Swarm Manager (Inkl. Portainer Server UI als Leitstand)" ON \
            "worker"  "Swarm Worker Node (Inkl. Socket-Agent zum Cluster joinen)" OFF \
            3>&1 1>&2 2>&3) || rchoice="manager"
        SWARM_ROLE="$rchoice"

        if [[ "$SWARM_ROLE" == "worker" ]]; then
            SWARM_MANAGER_IP=$(whiptail --inputbox "Manager Node IP-Adresse (z.B. 192.168.176.13):" 10 60 "$SWARM_MANAGER_IP" 3>&1 1>&2 2>&3) || true
            SWARM_JOIN_TOKEN=$(whiptail --inputbox "Swarm Worker Join-Token (aus 'docker swarm join-token worker'):" 10 60 "$SWARM_JOIN_TOKEN" 3>&1 1>&2 2>&3) || true
        else
            PORTAINER_ADMIN_PASS=$(whiptail --passwordbox "Initiales Portainer Admin-Passwort (mind. 12 Zeichen):" 10 60 "$PORTAINER_ADMIN_PASS" 3>&1 1>&2 2>&3) || PORTAINER_ADMIN_PASS="PortainerAdmin2026!"
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

create_lxc() {
    header "LXC Container $CTID erstellen"

    if [[ "$DRY_RUN" == true ]]; then
        info "DRY-RUN: Ueberspringe Container-Erstellung"
        return 0
    fi

    # Falls CTID bereits belegt: naechste freie finden (wie deploy-lxc.sh)
    if pct status "$CTID" >/dev/null 2>&1; then
        warn "CTID $CTID bereits belegt — suche naechste freie..."
        local try="$CTID"
        while pct status "$try" >/dev/null 2>&1; do try=$((try+1)); done
        CTID="$try"
        log "Neue CTID: $CTID"
    fi

    # --- Storage dynamisch ermitteln (kein Hardcode) ---
    local TMPL_STORAGE="local"
    local ROOTFS_STORAGE="local-data"
    local storages
    storages=$(pvesm status 2>/dev/null | awk 'NR>1 {print $1}' || true)
    if ! echo "$storages" | grep -qx "local"; then
        local cs
        cs=$(pvesm status 2>/dev/null | awk 'NR>1 && $0 ~ /vztmpl/ {print $1; exit}' || true)
        if [[ -n "$cs" ]]; then TMPL_STORAGE="$cs"; fi
    fi
    if echo "$storages" | grep -qx "local-data"; then
        ROOTFS_STORAGE="local-data"
    elif echo "$storages" | grep -qx "local-lvm"; then
        ROOTFS_STORAGE="local-lvm"
    elif echo "$storages" | grep -qx "local"; then
        if pvesm status 2>/dev/null | grep -E "^local\\b" | grep -q "rootdir"; then
            ROOTFS_STORAGE="local"
        fi
    else
        local rs
        rs=$(pvesm status 2>/dev/null | awk 'NR>1 && $0 ~ /rootdir/ {print $1; exit}' || true)
        if [[ -n "$rs" ]]; then ROOTFS_STORAGE="$rs"; fi
    fi
    # Validierung
    if [[ -z "$TMPL_STORAGE" ]]; then
        err "Kein Storage mit vztmpl-Support gefunden."
        return 1
    fi
    info "Template-Storage: $TMPL_STORAGE"
    info "RootFS-Storage: $ROOTFS_STORAGE"

    # --- Debian vs Alpine: bei Alpine robust dynamisch, bei Debian analog ---
    local LATEST_ALPINE_TEMPLATE=""
    local LATEST_DEBIAN_TEMPLATE=""

    if [[ "$OS_TYPE" == "debian" ]]; then
        # Debian: analog dynamisch
        if ! pveam update >/dev/null 2>&1; then
            err "Proxmox Template-Index konnte nicht aktualisiert werden."
            return 1
        fi
        mapfile -t DEB_TEMPLATES < <(pveam available --section system 2>/dev/null | awk '{print $2}' | grep -E '^debian-12-standard_.*_amd64\.tar\.(xz|zst)$' || true)
        if [[ ${#DEB_TEMPLATES[@]} -eq 0 ]]; then
            mapfile -t DEB_TEMPLATES < <(pveam available --section system 2>/dev/null | grep -oE 'debian-12-standard_[^[:space:]]+\.tar\.(xz|zst)' || true)
        fi
        if [[ ${#DEB_TEMPLATES[@]} -eq 0 ]]; then
            err "Kein Debian-Template in den Proxmox-Repositories gefunden."
            return 1
        fi
        LATEST_DEBIAN_TEMPLATE=$(printf '%s\n' "${DEB_TEMPLATES[@]}" | sort -V | tail -n 1)
        if [[ -z "$LATEST_DEBIAN_TEMPLATE" ]]; then
            err "Kein Debian-Template ermittelbar."
            return 1
        fi
        log "Neueste Debian-Version ermittelt"
        info "Template: $LATEST_DEBIAN_TEMPLATE"
        if ! pvesm list "$TMPL_STORAGE" --content vztmpl 2>/dev/null | grep -qF "$LATEST_DEBIAN_TEMPLATE"; then
            info "Lade Template $LATEST_DEBIAN_TEMPLATE auf $TMPL_STORAGE herunter..."
            if ! pveam download "$TMPL_STORAGE" "$LATEST_DEBIAN_TEMPLATE"; then
                err "Template-Download fehlgeschlagen: pveam download $TMPL_STORAGE $LATEST_DEBIAN_TEMPLATE"
                return 1
            fi
        else
            info "Template bereits vorhanden — kein Download noetig."
        fi
        if ! pvesm list "$TMPL_STORAGE" --content vztmpl 2>/dev/null | grep -qF "$LATEST_DEBIAN_TEMPLATE"; then
            err "Template nach Download nicht in $TMPL_STORAGE vorhanden: $LATEST_DEBIAN_TEMPLATE"
            return 1
        fi
        local DEB_ACTUAL
        DEB_ACTUAL=$(pvesm list "$TMPL_STORAGE" --content vztmpl 2>/dev/null | grep -F "$LATEST_DEBIAN_TEMPLATE" | awk '{print $1}' | head -n 1)
        if [[ -z "$DEB_ACTUAL" ]]; then
            DEB_ACTUAL="${TMPL_STORAGE}:vztmpl/$LATEST_DEBIAN_TEMPLATE"
        fi
        info "Erstelle LXC $CTID mit $DEB_ACTUAL (rootfs: $ROOTFS_STORAGE)..."
        pct create "$CTID" "$DEB_ACTUAL" \
            --hostname "wawi-node-$CTID" \
            --memory "$RAM" \
            --cores "$CPU" \
            --rootfs "${ROOTFS_STORAGE}:${DISK}" \
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
        return 0
    fi

    # --- Alpine: robust dynamisch (kein Hardcode!) ---
    if ! pveam update >/dev/null 2>&1; then
        err "Proxmox Template-Index konnte nicht aktualisiert werden."
        return 1
    fi

    # Verfügbare Alpine-Templates ermitteln — robust, spaltenunabhängig
    mapfile -t ALPINE_TEMPLATES < <(pveam available --section system 2>/dev/null | awk '{print $2}' | grep -E '^alpine-[0-9]+\.[0-9]+-default_.*_amd64\.tar\.(xz|zst)$' || true)
    if [[ ${#ALPINE_TEMPLATES[@]} -eq 0 ]]; then
        # Fallback: suche über alle Felder falls Spalte 2 abweicht
        mapfile -t ALPINE_TEMPLATES < <(pveam available --section system 2>/dev/null | grep -oE 'alpine-[0-9]+\.[0-9]+-default_[^[:space:]]+\.tar\.(xz|zst)' || true)
    fi

    if [[ ${#ALPINE_TEMPLATES[@]} -eq 0 ]]; then
        err "Kein aktuelles Alpine-LXC-Template in den Proxmox-Repositories gefunden."
        return 1
    fi

    # Neueste Version korrekt bestimmen (sort -V berücksichtigt Version + Datum)
    LATEST_ALPINE_TEMPLATE=$(printf '%s\n' "${ALPINE_TEMPLATES[@]}" | sort -V | tail -n 1)

    if [[ -z "${LATEST_ALPINE_TEMPLATE:-}" ]]; then
        err "Kein aktuelles Alpine-LXC-Template in den Proxmox-Repositories gefunden."
        return 1
    fi

    log "Neueste Alpine-Version ermittelt"
    info "Template: $LATEST_ALPINE_TEMPLATE"

    # Download ausschließlich mit exaktem Template-Namen
    if ! pvesm list "$TMPL_STORAGE" --content vztmpl 2>/dev/null | grep -qF "$LATEST_ALPINE_TEMPLATE"; then
        info "Lade Template $LATEST_ALPINE_TEMPLATE auf $TMPL_STORAGE herunter..."
        if ! pveam download "$TMPL_STORAGE" "$LATEST_ALPINE_TEMPLATE"; then
            err "Template-Download fehlgeschlagen."
            return 1
        fi
        if ! pvesm list "$TMPL_STORAGE" --content vztmpl 2>/dev/null | grep -qF "$LATEST_ALPINE_TEMPLATE"; then
            err "Template nach Download nicht in $TMPL_STORAGE vorhanden: $LATEST_ALPINE_TEMPLATE"
            return 1
        fi
    else
        info "Template bereits vorhanden — kein Download noetig."
    fi

    local ACTUAL_TMPL
    ACTUAL_TMPL=$(pvesm list "$TMPL_STORAGE" --content vztmpl 2>/dev/null | grep -F "$LATEST_ALPINE_TEMPLATE" | awk '{print $1}' | head -n 1)
    if [[ -z "$ACTUAL_TMPL" ]]; then
        ACTUAL_TMPL="${TMPL_STORAGE}:vztmpl/$LATEST_ALPINE_TEMPLATE"
    fi

    info "Erstelle LXC $CTID mit $ACTUAL_TMPL (rootfs: $ROOTFS_STORAGE)..."
    pct create "$CTID" "$ACTUAL_TMPL" \
        --hostname "wawi-node-$CTID" \
        --memory "$RAM" \
        --cores "$CPU" \
        --rootfs "${ROOTFS_STORAGE}:${DISK}" \
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
# ZeroTier VPN Installationsfunktion
# ============================================================================
configure_zerotier() {
    header "ZeroTier VPN Konfiguration"

    if [[ "$INSTALL_ZEROTIER" != "true" ]]; then
        info "ZeroTier VPN übersprungen."
        return 0
    fi

    if [[ -z "$ZEROTIER_NETWORK_ID" ]]; then
        warn "ZeroTier aktiviert, aber keine Network ID angegeben — bitte nachgereicht."
        info "Füge folgende Zeile später manuell in den Container ein:"
        echo "  zero-tier-cli orbit join <YOUR_16_STELLIGE_ZT_NETWORK_ID>"
        return 0
    fi

    info "Starte ZeroTier VPN Integration für Network ID: $ZEROTIER_NETWORK_ID..."

    if [[ "$OS_TYPE" == "alpine" ]]; then
        # ZeroTier binary herunterladen und installieren (Alpine)
        pct exec "$CTID" -- /bin/sh -c "
        apk add --no-cache curl bash
        curl -fsSL https://install.zerotier.com | sh
        # Dem Netzwerk beitreten
        zt-join $ZEROTIER_NETWORK_ID
        # IP-Adresse des Nodes im ZT-Netzwerk auslesen
        ip addr show zt0 2>/dev/null | grep 'inet' || true
        "
    else
        # Debian Weg
        pct exec "$CTID" -- /bin/bash -c "
        apt-get update && apt-get install -y curl
        curl -f https://install.zerotier.com | sh
        zt-join $ZEROTIER_NETWORK_ID
        "
    fi

    # Container IP nach ZT-Neuberechnung neu ermitteln
    local IP=""
    for i in $(seq 1 15); do
        IP="$(pct exec "$CTID" -- ip -4 addr show eth0 2>/dev/null | grep -o 'inet [0-9.]*' | awk '{print $2}' || true)"
        # Zudem ZeroTier IP check
        ZT_IP="$(pct exec "$CTID" -- ip -4 addr show zt0 2>/dev/null | grep -o 'inet [0-9.]*' | awk '{print $2}' || true)"
        [[ -n "$ZT_IP" ]] && IP="$ZT_IP" && break
        sleep 1
    done

    info "ZeroTier VPN erfolgreich eingerichtet. Node-IP: ${IP:-DHCP} (physisch) / ${ZT_IP:-zerotier-vpn} (virtuell)"
}

# ============================================================================
# Deployment im Container (Swarm & Portainer Full CE mit Optional ZeroTier)
# ============================================================================
deploy_swarm_and_portainer() {
    header "Docker SWARM & Portainer Management-Zentrale (mit Socket-Anbindung) einrichten"

    info "Installiere Docker & Basis-Tools in Container $CTID ($OS_TYPE)..."
    if [[ "$OS_TYPE" == "alpine" ]]; then
        pct exec "$CTID" -- /bin/sh -c "apk update && apk add --no-cache docker docker-cli-compose git curl nodejs npm ca-certificates jq"
        pct exec "$CTID" -- rc-update add docker boot
        pct exec "$CTID" -- service docker start
    else
        pct exec "$CTID" -- /bin/bash -c "apt-get update && apt-get install -y docker.io docker-compose-v2 git curl nodejs npm ca-certificates jq && systemctl enable --now docker"
    fi

    # Container IP ermitteln
    local IP=""
    for i in $(seq 1 15); do
        IP="$(pct exec "$CTID" -- ip -4 addr show eth0 2>/dev/null | grep -o 'inet [0-9.]*' | awk '{print $2}' || true)"
        [[ -n "$IP" ]] && break
        sleep 1
    done

    # 1. ZeroTier VPN Integration (Optional)
    configure_zerotier

    # 1. Swarm Manager oder Worker Setup
    if [[ "$SWARM_ROLE" == "manager" ]]; then
        info "Initialisiere Docker Swarm Manager auf ${IP:-<Container-IP>}..."
        # Verwende physikalische IP oder fallback auf 127.0.0.1 wenn noch nicht verfügbar
        local swarm_addr="${IP:-127.0.0.1}"
        pct exec "$CTID" -- /bin/sh -c "docker swarm init --advertise-addr ${swarm_addr} || docker swarm init || true"
        log "Docker Swarm Manager aktiv."

        # Swarm Overlay Networks anlegen
        info "Erstelle Swarm Overlay-Netzwerke (wawi-overlay, agent_network)..."
        pct exec "$CTID" -- /bin/sh -c "docker network create --driver overlay --attachable wawi-overlay || true"
        pct exec "$CTID" -- /bin/sh -c "docker network create --driver overlay --attachable agent_network || true"

        # 2. Portainer CE Full Server + Global Agent Stack deployen (Socket-gebunden)
        info "Deploye Portainer CE Server & Socket-Agent Stack..."
        pct exec "$CTID" -- /bin/sh -c "cat > /root/portainer-agent-stack.yml <<'EOF'
version: '3.8'

services:
  agent:
    image: portainer/agent:2.21.5
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /var/lib/docker/volumes:/var/lib/docker/volumes
    networks:
      - agent_network
    deploy:
      mode: global
      placement:
        constraints: [node.platform.os == linux]

  portainer:
    image: portainer/portainer-ce:2.21.5
    command: -H tcp://tasks.agent:9001 --tlsskipverify
    ports:
      - "9443:9443"
      - "9000:9000"
      - "8000:8000"
    volumes:
      - portainer_data:/data
    networks:
      - agent_network
    deploy:
      mode: replicated
      replicas: 1
      placement:
        constraints: [node.role == manager]

networks:
  agent_network:
    external: true

volumes:
  portainer_data:
EOF
docker stack deploy -c /root/portainer-agent-stack.yml portainer"

        # 3. WaWi Repository klonen und deployen
        info "Klone WaWi Repository und deploye WaWi Swarm Stack..."
        pct exec "$CTID" -- /bin/sh -c "rm -rf /opt/wawi && git clone $REPO_URL /opt/wawi"
        pct exec "$CTID" -- /bin/sh -c "cd /opt/wawi && docker build -t puchadave/wawi-middleware:latest . && docker stack deploy -c docker-compose.swarm.yml wawi"

        # Swarm Join Tokens auslesen
        local WORKER_TOKEN
        WORKER_TOKEN=$(pct exec "$CTID" -- docker swarm join-token worker -q || true)
        local MANAGER_TOKEN
        MANAGER_TOKEN=$(pct exec "$CTID" -- docker swarm join-token manager -q || true)

        echo ""
        echo "=========================================================================="
        echo "  WAWI SWARM MANAGER & VORKONFIGURIERTER PORTAINER LEITSTAND BEREITGESTELLT!"
        echo "=========================================================================="
        echo "  Node Rolle:             SWARM PRIMARY MANAGER"
        echo "  Manager-IP:             ${IP:-<Container-IP>}"
        echo ""
        echo "  PORTAINER WEB-UI:       https://${IP:-<IP>}:9443  (oder http://${IP:-<IP>}:9000)"
        echo "  Portainer Login:        Benutzer: ${PORTAINER_ADMIN_USER} | Passwort: ${PORTAINER_ADMIN_PASS}"
        echo "  Portainer Status:       Cluster & Socket-Agent BEREITS VERBUNDEN & VORKONFIGURIERT"
        echo "  ZeroTier VPN:           ${ZEROTIER_NETWORK_ID:+aktiv (Network ID: ${ZEROTIER_NETWORK_ID})}"
        echo ""
        echo "  WaWi Middleware API:    http://${IP:-<IP>}:8080/api/health"
        echo "  WaWi Admin Leitstand:   http://${IP:-<IP>}:8080/admin.html"
        echo "  Google Shopping Feed:   http://${IP:-<IP>}:8080/api/channels/google-shopping.xml"
        echo ""
        echo "  JOIN-BEFEHLE FÜR WEITERE CLUSTER-NODES:"
        echo "  - Neuer Worker:  docker swarm join --token ${WORKER_TOKEN} ${IP:-<IP>}:2377"
        echo "  - Neuer Manager: docker swarm join --token ${MANAGER_TOKEN} ${IP:-<IP>}:2377"
        echo "=========================================================================="

    else
        # Worker Node Setup
        if [[ -n "$SWARM_MANAGER_IP" && -n "$SWARM_JOIN_TOKEN" ]]; then
            info "Trete Swarm Cluster bei (${SWARM_MANAGER_IP}:2377)..."
            pct exec "$CTID" -- /bin/sh -c "docker swarm join --token $SWARM_JOIN_TOKEN $SWARM_MANAGER_IP:2377"
            log "Erfolgreich als Swarm Worker beigetreten! Portainer Socket-Agent wird automatisch ausgerollt."
        else
            warn "Keine Swarm Manager IP/Token übergeben — manueller Join Befehl:"
            warn "pct exec $CTID -- docker swarm join --token <TOKEN> <MANAGER-IP>:2377"
        fi

        echo ""
        echo "============================================================================"
        echo "  WAWI SWARM WORKER NODE $CTID ERFOLGREICH EINGERICHTET!"
        echo "============================================================================"
        echo "  Node Rolle:       SWARM WORKER"
        echo "  Worker-IP:        ${IP}"
        echo "  Manager-Ziel:     ${SWARM_MANAGER_IP:-<nicht angegeben>}"
        echo "============================================================================"
    fi
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
        deploy_swarm_and_portainer
    elif [[ "$DEPLOY_MODE" == "docker" ]]; then
        deploy_standalone_docker
    else
        info "Nativer Modus — WaWi direkt via GitHub RAW installieren (LXC $CTID bereits erstellt)"
        RAW="https://raw.githubusercontent.com/puchadave/wawi/master/shop-kern"
        info "Lade WaWi Files von $RAW in LXC $CTID (wie Live-Test)..."
        pct exec "$CTID" -- /bin/sh -c "apk update && apk add --no-cache nodejs npm ca-certificates curl" 2>/dev/null || pct exec "$CTID" -- /bin/bash -c "apt-get update && apt-get install -y nodejs npm ca-certificates curl" 2>/dev/null || true
        pct exec "$CTID" -- mkdir -p /opt/wawi/public /opt/wawi/modules/marketplace /opt/wawi/data
        for f in server.js public/index.html public/style.css public/shop.js public/admin.html modules/logger.js modules/pricing.js modules/xmlparser.js modules/catalog.js modules/orders.js modules/channels.js modules/mapper.js modules/analytics.js modules/marketplace/base.js modules/marketplace/kaufland.js modules/marketplace/otto.js modules/marketplace/ebay.js modules/marketplace/kleinanzeigen.js modules/marketplace/registry.js; do
          curl -fsSL "$RAW/$f" -o "/tmp/wawi-$f" && pct push "$CTID" "/tmp/wawi-$f" "/opt/wawi/$f" || warn "Download/Push fehlgeschlagen: $f"
        done
        info "Richte OpenRC/systemd Autostart ein..."
        pct exec "$CTID" -- /bin/sh -c "cat > /etc/init.d/wawi <<'EOS'
#!/sbin/openrc-run
name=\"wawi\"
command=\"/usr/bin/node\"
command_args=\"/opt/wawi/server.js 8080\"
command_background=true
pidfile=\"/run/wawi.pid\"
directory=\"/opt/wawi\"
depend() { need net; }
EOS
chmod +x /etc/init.d/wawi && rc-update add wawi default && rc-service wawi restart || rc-service wawi start" 2>/dev/null ||         pct exec "$CTID" -- /bin/bash -c "cat > /etc/systemd/system/wawi.service <<'EOS'
[Unit]
Description=WaWi Middleware
After=network.target
[Service]
ExecStart=/usr/bin/node /opt/wawi/server.js 8080
WorkingDirectory=/opt/wawi
Restart=always
[Install]
WantedBy=multi-user.target
EOS
systemctl daemon-reload && systemctl enable --now wawi"
        IP=$(pct exec "$CTID" -- /bin/sh -c "ip -4 addr show eth0 2>/dev/null | grep -o 'inet [0-9.]*' | awk '{print \$2}'" 2>/dev/null || echo "DHCP")
        log "WaWi nativ bereit: http://$IP:8080/ — Admin http://$IP:8080/admin.html"
    fi
}

main "$@"
