#!/bin/sh
# WaWi Shop-Kern — LXC-Installation auf Proxmox VE (nativ, ohne Docker)
# Erstellt LXC, installiert nodejs nativ, kopiert shop-kern & modules, OpenRC-Autostart.
# Laedt Shop-Dateien bei Bedarf selbst von GitHub (kein git, kein Clone noetig).
# TEMPLATE: wird IMMER dynamisch als neuestes Alpine ermittelt, kein Hardcode.
set -e

CTID="${CTID:-}"
HOSTNAME="wawishop"
STORAGE="${STORAGE:-}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-}"
RAM="${RAM:-2048}"
CPU="${CPU:-2}"
DISK="${DISK:-8}"
GITHUB_RAW="${GITHUB_RAW:-https://raw.githubusercontent.com/puchadave/wawi/master/shop-kern}"

info() { echo "[i] $*"; }
ok()   { echo "[✓] $*"; }
err()  { echo "[FEHLER] $*" >&2; exit 1; }

command -v pct >/dev/null 2>&1 || err "kein pct — Script muss auf dem Proxmox-Host laufen"
id -u | grep -q '^0$' || err "Script als root ausführen (sudo -i)"

# Naechste freie Container-ID
if [ -z "$CTID" ]; then
  CTID=200
  while pct status "$CTID" >/dev/null 2>&1; do CTID=$((CTID+1)); done
fi
info "Container-ID: $CTID"

# --- Storage dynamisch ermitteln (kein Hardcode) ---
if [ -z "$STORAGE" ]; then
  # RootFS: bevorzuge local-data > local-lvm > local (mit rootdir)
  if pvesm status 2>/dev/null | awk 'NR>1{print $1}' | grep -qx "local-data"; then
    STORAGE="local-data"
  elif pvesm status 2>/dev/null | awk 'NR>1{print $1}' | grep -qx "local-lvm"; then
    STORAGE="local-lvm"
  elif pvesm status 2>/dev/null | grep -E "^local\\b" | grep -q "rootdir"; then
    STORAGE="local"
  else
    STORAGE=$(pvesm status 2>/dev/null | awk 'NR>1 && $0 ~ /rootdir/ {print $1; exit}')
    [ -z "$STORAGE" ] && STORAGE="local"
  fi
fi
if [ -z "$TEMPLATE_STORAGE" ]; then
  if pvesm status 2>/dev/null | awk 'NR>1{print $1}' | grep -qx "local"; then
    TEMPLATE_STORAGE="local"
  else
    TEMPLATE_STORAGE=$(pvesm status 2>/dev/null | awk 'NR>1 && $0 ~ /vztmpl/ {print $1; exit}')
    [ -z "$TEMPLATE_STORAGE" ] && TEMPLATE_STORAGE="local"
  fi
fi
echo "[i] Template-Storage: $TEMPLATE_STORAGE"
echo "[i] RootFS-Storage: $STORAGE"

# --- Neuestes Alpine-Template dynamisch ermitteln (kein Hardcode!) ---
# pveam update zwingend
if ! pveam update >/dev/null 2>&1; then
  echo "[✗] Proxmox Template-Index konnte nicht aktualisiert werden." >&2
  exit 1
fi

LATEST=""
# Spalte 2 ist bei Standard-PVE der Paketname
LATEST=$(pveam available --section system 2>/dev/null | awk '{print $2}' | grep -E '^alpine-[0-9]+\.[0-9]+-default_.*_amd64\.tar\.(xz|zst)$' | sort -V | tail -n 1 || true)
if [ -z "$LATEST" ]; then
  LATEST=$(pveam available --section system 2>/dev/null | grep -oE 'alpine-[0-9]+\.[0-9]+-default_[^[:space:]]+\.tar\.(xz|zst)' | sort -V | tail -n 1 || true)
fi

if [ -z "$LATEST" ]; then
  echo "[✗] Kein aktuelles Alpine-LXC-Template in den Proxmox-Repositories gefunden." >&2
  exit 1
fi
echo "[✓] Neueste Alpine-Version ermittelt"
echo "[i] Template: $LATEST"

# Download pruefen / durchfuehren
if ! pvesm list "$TEMPLATE_STORAGE" --content vztmpl 2>/dev/null | grep -qF "$LATEST"; then
  echo "[i] Lade Template $LATEST auf $TEMPLATE_STORAGE herunter..."
  if ! pveam download "$TEMPLATE_STORAGE" "$LATEST"; then
    echo "[✗] Template-Download fehlgeschlagen." >&2
    exit 1
  fi
  if ! pvesm list "$TEMPLATE_STORAGE" --content vztmpl 2>/dev/null | grep -qF "$LATEST"; then
    echo "[✗] Template nach Download nicht in $TEMPLATE_STORAGE vorhanden: $LATEST" >&2
    exit 1
  fi
else
  echo "[i] Template bereits vorhanden — kein Download noetig."
fi

TEMPLATE_PATH=$(pvesm list "$TEMPLATE_STORAGE" --content vztmpl 2>/dev/null | grep -F "$LATEST" | awk '{print $1}' | head -n 1)
if [ -z "$TEMPLATE_PATH" ]; then
  TEMPLATE_PATH="${TEMPLATE_STORAGE}:vztmpl/$LATEST"
fi
echo "[i] Verwende Template: $TEMPLATE_PATH"

# LXC erstellen
echo "[i] Erstelle LXC $CTID ($HOSTNAME) ..."
pct create "$CTID" "$TEMPLATE_PATH" \
  --hostname "$HOSTNAME" \
  --memory "$RAM" \
  --cores "$CPU" \
  --rootfs "$STORAGE:$DISK" \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --unprivileged 1 \
  --features nesting=1 \
  --onboot 1 \
  --description "WaWi Shop-Kern (Produktiv & Multi-Channel)"

echo "[i] Starte LXC $CTID ..."
pct start "$CTID"

# Auf Start warten
echo "[i] Warte auf Systemstart ..."
for i in $(seq 1 60); do
  if pct exec "$CTID" -- /bin/true 2>/dev/null; then break; fi
  sleep 2
done

echo "[i] Installiere nodejs (nativ, Alpine) ..."
pct exec "$CTID" -- /bin/sh -c "apk update && apk add --no-cache nodejs npm ca-certificates curl"

# Shop-Dateien sicherstellen
FILES_LIST="server.js public/index.html public/style.css public/shop.js public/admin.html modules/logger.js modules/pricing.js modules/xmlparser.js modules/catalog.js modules/orders.js modules/channels.js modules/mapper.js modules/analytics.js modules/marketplace/base.js modules/marketplace/kaufland.js modules/marketplace/otto.js modules/marketplace/ebay.js modules/marketplace/kleinanzeigen.js modules/marketplace/registry.js"

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SRC_DIR/server.js" ] && [ "${FORCE_GITHUB:-0}" != "1" ]; then
  LOCAL_SRC="$SRC_DIR"
else
  LOCAL_SRC=""
fi

if [ -z "$LOCAL_SRC" ]; then
  echo "[i] Lade Shop-Kern von GitHub ..."
  command -v curl >/dev/null 2>&1 || { apt-get update >/dev/null 2>&1; apt-get install -y curl >/dev/null 2>&1 || apk add --no-cache curl >/dev/null 2>&1; }
  TMPDIR_DL="/root/wawi-shop-dl"
  rm -rf "$TMPDIR_DL" && mkdir -p "$TMPDIR_DL"
  for f in $FILES_LIST; do
    mkdir -p "$TMPDIR_DL/$(dirname "$f")"
    curl -fsSL -o "$TMPDIR_DL/$f" "$GITHUB_RAW/$f" || err "Download fehlgeschlagen: $GITHUB_RAW/$f"
  done
  LOCAL_SRC="$TMPDIR_DL"
fi

echo "[i] Kopiere shop-kern & Module in Container ..."
pct exec "$CTID" -- mkdir -p /opt/wawi/public /opt/wawi/modules/marketplace /opt/wawi/data

for f in $FILES_LIST; do
  if [ -f "$LOCAL_SRC/$f" ]; then
    pct push "$CTID" "$LOCAL_SRC/$f" "/opt/wawi/$f"
  fi
done

# OpenRC-Service fuer Autostart
echo "[i] Konfiguriere OpenRC-Autostart & Supervision ..."
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

echo "[i] Starte WaWi-Dienst ..."
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
echo "  WaWi Shop-Kern M-^@M-^T ERFOLGREICH BEREITGESTELLT!"
echo "================================================================"
echo "  Container:     $CTID ($HOSTNAME)"
echo "  IP-Adresse:    ${IP:-DHCP zugewiesen}"
echo "  Shop:          http://${IP:-<container-ip>}:8080/"
echo "  Google Feed:   http://${IP:-<container-ip>}:8080/api/channels/google-shopping.xml"
echo "  Admin-Panel:   http://${IP:-<container-ip>}:8080/admin.html"
echo "  Admin-Keyfile: /opt/wawi/data/admin.key"
echo "================================================================"
