#!/bin/sh
# WaWi Shop-Kern v2.0 — LXC-Installation auf Proxmox VE (nativ, ohne Docker)
# Aufruf auf dem PVE-Host:  sh deploy-lxc.sh
# Erstellt LXC, installiert nodejs nativ, kopiert shop-kern, OpenRC-Autostart.
# Lädt die Shop-Dateien bei Bedarf selbst von GitHub (kein git, kein Clone nötig).
set -e

CTID="${CTID:-}"
HOSTNAME="wawishop"
STORAGE="${STORAGE:-local-lvm}"
TEMPLATE="${TEMPLATE:-alpine-3.20-default}"
RAM="${RAM:-2048}"
CPU="${CPU:-2}"
DISK="${DISK:-8}"
GITHUB_RAW="${GITHUB_RAW:-https://raw.githubusercontent.com/puchadave/wawi/master/shop-kern}"

info() { echo "[i] $*"; }
err()  { echo "[FEHLER] $*" >&2; exit 1; }

command -v pct >/dev/null 2>&1 || err "kein pct — Script muss auf dem Proxmox-Host laufen"
id -u | grep -q '^0$' || err "Script als root ausführen (sudo -i)"

# Nächste freie Container-ID
if [ -z "$CTID" ]; then
  CTID=200
  while pct status "$CTID" >/dev/null 2>&1; do CTID=$((CTID+1)); done
fi
info "Container-ID: $CTID"

# Template sicherstellen
if ! pveam list "$STORAGE" 2>/dev/null | grep -q "$TEMPLATE"; then
  info "Template $TEMPLATE wird geladen ..."
  pveam update >/dev/null 2>&1 || true
  pveam download "$STORAGE" "$TEMPLATE" || \
    err "Template-Download fehlgeschlagen — manuell: pveam download $STORAGE $TEMPLATE"
fi

# LXC erstellen (netz: dhcp -> IP wird ausgegeben)
info "Erstelle LXC $CTID ($HOSTNAME) ..."
pct create "$CTID" "$STORAGE:vztmpl/$TEMPLATE" \
  --hostname "$HOSTNAME" \
  --memory "$RAM" \
  --cores "$CPU" \
  --rootfs "$STORAGE:$DISK" \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --unprivileged 1 \
  --features nesting=1 \
  --onboot 1 \
  --description "WaWi Shop-Kern v2.0 (produktiv)"

info "Starte LXC $CTID ..."
pct start "$CTID"

# Auf SSH/Start warten
info "Warte auf Systemstart ..."
for i in $(seq 1 60); do
  if pct exec "$CTID" -- /bin/true 2>/dev/null; then break; fi
  sleep 2
done

info "Installiere nodejs (nativ, Alpine) ..."
pct exec "$CTID" -- /bin/sh -c "apk update && apk add --no-cache nodejs npm ca-certificates"

# Shop-Dateien sicherstellen: lokal vorhanden? sonst von GitHub laden
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SRC_DIR/server.js" ]; then
  LOCAL_SRC="$SRC_DIR"
else
  LOCAL_SRC=""
fi

if [ -z "$LOCAL_SRC" ]; then
  info "Lade Shop-Kern von GitHub ..."
  command -v curl >/dev/null 2>&1 || { apt-get update >/dev/null 2>&1; apt-get install -y curl >/dev/null 2>&1 || apk add --no-cache curl >/dev/null 2>&1; }
  TMPDIR_DL="/root/wawi-shop-dl"
  rm -rf "$TMPDIR_DL" && mkdir -p "$TMPDIR_DL"
  for f in server.js public/index.html public/style.css public/shop.js public/admin.html; do
    mkdir -p "$TMPDIR_DL/$(dirname "$f")"
    curl -fsSL -o "$TMPDIR_DL/$f" "$GITHUB_RAW/$f" || err "Download fehlgeschlagen: $GITHUB_RAW/$f"
  done
  LOCAL_SRC="$TMPDIR_DL"
fi

info "Kopiere shop-kern in Container ..."
pct exec "$CTID" -- mkdir -p /opt/wawi
for f in server.js public/index.html public/style.css public/shop.js public/admin.html; do
  [ -f "$LOCAL_SRC/$f" ] && pct push "$CTID" "$LOCAL_SRC/$f" "/opt/wawi/$f"
done

# OpenRC-Service für Autostart
info "Konfiguriere OpenRC-Autostart ..."
pct exec "$CTID" -- /bin/sh -c "cat > /etc/init.d/wawi <<'EOF'
#!/sbin/openrc-run
name=\"wawi\"
command=\"/usr/bin/node\"
command_args=\"/opt/wawi/server.js 8080\"
command_background=true
pidfile=\"/run/wawi.pid\"
depend() { need net; }
EOF
chmod +x /etc/init.d/wawi && rc-update add wawi default"

info "Starte WaWi-Service ..."
pct exec "$CTID" -- /etc/init.d/wawi start

sleep 3
IP=$(pct exec "$CTID" -- /bin/sh -c "ip -4 addr show eth0 | grep -oE 'inet [0-9.]+' | awk '{print \$2}'" 2>/dev/null | head -1)

info "================================================="
info " WaWi Shop-Kern v2.0 BEREIT"
info " Container:  $CTID ($HOSTNAME)"
info " Shop:       http://$IP:8080/"
info " Admin:      http://$IP:8080/admin.html"
info " Passwort:   im Container: cat /opt/wawi/data/admin-passwort.txt"
info "================================================="