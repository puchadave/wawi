#!/bin/sh
# WaWi Shop-Kern v2.3 — LXC-Installation auf Proxmox VE (nativ, ohne Docker)
# Aufruf auf dem PVE-Host:  sh deploy-lxc.sh
# Erstellt LXC, installiert nodejs nativ, kopiert shop-kern & modules, OpenRC-Autostart.
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
  --description "WaWi Shop-Kern v2.3 (Produktiv & Multi-Channel)"

info "Starte LXC $CTID ..."
pct start "$CTID"

# Auf Start warten
info "Warte auf Systemstart ..."
for i in $(seq 1 60); do
  if pct exec "$CTID" -- /bin/true 2>/dev/null; then break; fi
  sleep 2
done

info "Installiere nodejs (nativ, Alpine) ..."
pct exec "$CTID" -- /bin/sh -c "apk update && apk add --no-cache nodejs npm ca-certificates curl"

# Shop-Dateien sicherstellen
FILES_LIST="server.js public/index.html public/style.css public/shop.js public/admin.html modules/logger.js modules/pricing.js modules/xmlparser.js modules/catalog.js modules/orders.js modules/channels.js"

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
  for f in $FILES_LIST; do
    mkdir -p "$TMPDIR_DL/$(dirname "$f")"
    curl -fsSL -o "$TMPDIR_DL/$f" "$GITHUB_RAW/$f" || err "Download fehlgeschlagen: $GITHUB_RAW/$f"
  done
  LOCAL_SRC="$TMPDIR_DL"
fi

info "Kopiere shop-kern & Module in Container ..."
pct exec "$CTID" -- mkdir -p /opt/wawi/public /opt/wawi/modules /opt/wawi/data

for f in $FILES_LIST; do
  if [ -f "$LOCAL_SRC/$f" ]; then
    pct push "$CTID" "$LOCAL_SRC/$f" "/opt/wawi/$f"
  fi
done

# OpenRC-Service für Autostart
info "Konfiguriere OpenRC-Autostart & Supervision ..."
pct exec "$CTID" -- /bin/sh -c "cat > /etc/init.d/wawi <<'EOF'
#!/sbin/openrc-run
name=\"wawi\"
command=\"/usr/bin/node\"
command_args=\"/opt/wawi/server.js 8080\"
command_background=true
pidfile=\"/run/wawi.pid\"
directory=\"/opt/wawi\"
depend() { need net; }
EOF
chmod +x /etc/init.d/wawi && rc-update add wawi default"

info "Starte WaWi-Dienst ..."
pct exec "$CTID" -- rc-service wawi restart || pct exec "$CTID" -- rc-service wawi start

# IP ermitteln
IP=""
for i in $(seq 1 30); do
  IP="$(pct exec "$CTID" -- ip -4 addr show eth0 2>/dev/null | grep -o 'inet [0-9.]*' | awk '{print $2}' || true)"
  [ -n "$IP" ] && break
  sleep 1
done

# Admin-Passwort auslesen
sleep 2
ADMIN_PW="$(pct exec "$CTID" -- /bin/sh -c "grep -o 'INITIALES ADMIN-PASSWORT: [^ ]*' /opt/wawi/data/logs/* 2>/dev/null | head -1 | awk '{print \$NF}' || true")"

echo ""
echo "================================================================"
echo "  WaWi Shop-Kern v2.3 — ERFOLGREICH BEREITGESTELLT!"
echo "================================================================"
echo "  Container:     $CTID ($HOSTNAME)"
echo "  IP-Adresse:    ${IP:-DHCP zugewiesen}"
echo "  Shop:          http://${IP:-<container-ip>}:8080/"
echo "  Google Feed:   http://${IP:-<container-ip>}:8080/api/channels/google-shopping.xml"
echo "  Admin-Panel:   http://${IP:-<container-ip>}:8080/admin.html"
echo "  Admin-Keyfile: /opt/wawi/data/admin.key"
echo "================================================================"
