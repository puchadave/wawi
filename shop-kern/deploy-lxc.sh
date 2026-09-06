#!/bin/sh
# WaWi Shop-Kern v2.0 — LXC-Installation auf Proxmox VE (nativ, ohne Docker)
# Aufruf auf dem PVE-Host:  sh deploy-lxc.sh
# Erstellt LXC, installiert nodejs nativ, kopiert shop-kern, OpenRC-Autostart.
set -e

CTID="${CTID:-}"
HOSTNAME="wawishop"
STORAGE="${STORAGE:-local-lvm}"
TEMPLATE="${TEMPLATE:-alpine-3.20-default}"
RAM="${RAM:-2048}"
CPU="${CPU:-2}"
DISK="${DISK:-8}"

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

info "Kopiere shop-kern in Container ..."
pct push "$CTID" "$(dirname "$0")" /opt/wawi 2>/dev/null || \
  pct exec "$CTID" -- mkdir -p /opt/wawi
if [ -d "$(dirname "$0")/../shop-kern" ]; then
  pct push "$CTID" "$(dirname "$0")/../shop-kern" /opt/wawi-shop 2>/dev/null || true
fi
# Falls shop-kern direkt im aktuellen Verzeichnis liegt
if [ -d "$(dirname "$0")/shop-kern" ]; then
  pct exec "$CTID" -- mkdir -p /opt/wawi-shop
  pct push "$CTID" "$(dirname "$0")/shop-kern" /opt/wawi 2>/dev/null || true
  # Unterverzeichnisse einzeln pushen (pct push kopiert keinen Ordner)
  for f in shop-kern/server.js shop-kern/public/index.html shop-kern/public/style.css shop-kern/public/shop.js shop-kern/public/admin.html; do
    [ -f "$f" ] && pct push "$CTID" "$f" "/opt/wawi/$(basename "$f")"
  done
fi

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