#!/bin/sh
# WaWi Cluster & Middleware Deployment Script (Docker Compose & Swarm HA)
# Nutzung:
#   sh deploy-cluster.sh swarm     # Docker Swarm HA + Portainer CE Server (Standard)
#   sh deploy-cluster.sh compose   # Standard Docker Compose + Portainer Agent
#   sh deploy-cluster.sh health    # Healthcheck: /ready + /health + docker service ls
#   sh deploy-cluster.sh logs      # Logs: wawi_wawi-middleware tail 100
#   ZEROTIER_NETWORK_ID=<id> sh deploy-cluster.sh swarm  # zusaetzlich ZeroTier-Planet als Fallback-Netz
set -e

MODE="${1:-swarm}"

info() { echo "\033[1;34m[INFO]\033[0m $*"; }
ok()   { echo "\033[1;32m[OK]\033[0m $*"; }
warn() { echo "\033[1;33m[WARN]\033[0m $*"; }
err()  { echo "\033[1;31m[FEHLER]\033[0m $*" >&2; exit 1; }

cd "$(dirname "$0")"

# --- health / logs subcommands (kein Docker Build, nur Diagnose) ---
if [ "$MODE" = "health" ]; then
  info "Healthcheck — /ready (200 nur wenn DB+Redis ok) + /health (informativ) + Swarm Status"
  echo "  curl 127.0.0.1:8080/ready ..."
  curl -s http://127.0.0.1:8080/ready 2>&1 | head -c 2000; echo ""
  echo "  curl 127.0.0.1:8080/health ..."
  curl -s http://127.0.0.1:8080/health 2>&1 | head -c 2000; echo ""
  echo "  curl 127.0.0.1:8080/api/health (shop-kern legacy compat) ..."
  curl -s http://127.0.0.1:8080/api/health 2>&1 | head -c 2000; echo ""
  if command -v docker >/dev/null 2>&1; then
    echo "--- docker stack ps wawi ---"
    docker stack ps wawi 2>&1 | head -n 40 || true
    echo "--- docker service ls ---"
    docker service ls 2>&1 | head -n 40 || true
    echo "--- docker service ps wawi_wawi-middleware ---"
    docker service ps wawi_wawi-middleware 2>&1 | head -n 40 || true
  fi
  # optional: admin health via tokenless? needs auth — nur Hinweis
  echo "Fuer GET /api/admin/health und /api/admin/stats: WAWI_ADMIN_PASSWORD setzen und scripts/e2e.sh ausfuehren."
  exit 0
fi

if [ "$MODE" = "logs" ]; then
  info "Logs — wawi_wawi-middleware (tail 100) + postgres/redis wenn verfuegbar"
  if command -v docker >/dev/null 2>&1; then
    if docker info 2>/dev/null | grep -q "Swarm: active"; then
      docker service logs wawi_wawi-middleware --tail 100 2>&1 | tail -n 150 || true
      echo "--- redis ---"
      docker service logs wawi_redis --tail 30 2>&1 | tail -n 40 || true
      echo "--- postgres ---"
      docker service logs wawi_postgres --tail 30 2>&1 | tail -n 40 || true
    else
      docker compose logs --tail 100 wawi-middleware 2>&1 | tail -n 150 || docker logs wawi-middleware --tail 100 2>&1 | tail -n 150 || true
    fi
  else
    err "docker nicht gefunden"
  fi
  exit 0
fi

if [ "$MODE" != "swarm" ] && [ "$MODE" != "compose" ]; then
  err "Unbekannter Modus '$MODE' — erwarte: swarm | compose | health | logs"
fi

info "Pruefe Docker Installation ..."
command -v docker >/dev/null 2>&1 || err "Docker ist nicht installiert."

# ZeroTier-Planet Hinweis (optional, kein Host-Mode fuer Middleware)
if [ -n "${ZEROTIER_NETWORK_ID:-}" ]; then
  info "ZeroTier-Planet konfiguriert (NETWORK_ID=${ZEROTIER_NETWORK_ID}) — deploye zerotier-planet als zusaetzliches Overlay (Fallback-Netz, kein host mode fuer wawi-middleware)."
  if [ ! -f docker-compose.zerotier.yml ]; then
    warn "docker-compose.zerotier.yml nicht gefunden — ueberspringe ZeroTier Service (siehe README/docs/RUNBOOK)."
  fi
else
  info "ZeroTier-Planet nicht konfiguriert (ZEROTIER_NETWORK_ID leer) — fahre ohne zusaetzliches Mesh fort. Fuer Fallback-Netz: ZEROTIER_NETWORK_ID=<id> sh deploy-cluster.sh swarm"
fi

if [ "$MODE" = "swarm" ]; then
  info "Starte Deployment im Docker Swarm Modus (High Availability & Portainer CE) ..."

  # Swarm Status pruefen
  if ! docker info 2>/dev/null | grep -q "Swarm: active"; then
    info "Initialisiere Docker Swarm ..."
    docker swarm init || true
  fi

  # Overlay-Netzwerke sicherstellen
  docker network create --driver overlay --attachable wawi-overlay 2>/dev/null || true
  docker network create --driver overlay --attachable agent_network 2>/dev/null || true

  # 1. Portainer CE Server + Global Agent deployen
  info "Deploye Portainer CE Server & Agent Stack (Zentraler Swarm Leitstand)..."
  cat > /tmp/portainer-swarm.yml <<'EOF'
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

  docker stack deploy -c /tmp/portainer-swarm.yml portainer

  # 2. WaWi Middleware Image bauen & Swarm Stack deployen
  info "Baue aktuelles WaWi-Middleware Image ..."
  docker build -t puchadave/wawi-middleware:latest .

  info "Deploye WaWi Middleware Stack 'wawi' ..."
  if [ -n "${ZEROTIER_NETWORK_ID:-}" ] && [ -f docker-compose.zerotier.yml ]; then
    docker stack deploy -c docker-compose.swarm.yml -c docker-compose.zerotier.yml wawi
  else
    docker stack deploy -c docker-compose.swarm.yml wawi
  fi

  ok "Swarm Stack & Portainer Server erfolgreich gestartet!"
  echo ""
  echo "================================================================"
  echo "  PORTAINER SWARM LEITSTAND: https://localhost:9443  (oder :9000)"
  echo "  WAWI MIDDLEWARE /ready:    http://localhost:8080/ready  (200 nur wenn DB+Redis ok)"
  echo "  WAWI MIDDLEWARE /health:   http://localhost:8080/health (informativ, dbMs/redisMs)"
  echo "  WAWI ADMIN LEITSTAND:      http://localhost:8080/admin.html"
  echo "  Shopware: extern (SHOPWARE_API_URL), kein interner Shop (410)"
  echo "  Diagnose: sh deploy-cluster.sh health | sh deploy-cluster.sh logs"
  echo "  E2E:      BASE_URL=http://127.0.0.1:8080 WAWI_ADMIN_PASSWORD=... sh scripts/e2e.sh"
  echo "================================================================"

else
  info "Starte Deployment im Standard Docker Compose Modus ..."

  docker compose down --remove-orphans 2>/dev/null || true
  docker compose build
  if [ -n "${ZEROTIER_NETWORK_ID:-}" ] && [ -f docker-compose.zerotier.yml ]; then
    docker compose -f docker-compose.yml -f docker-compose.zerotier.yml up -d
  else
    docker compose up -d
  fi

  # Portainer Agent Container (nur compose)
  docker run -d -p 9001:9001 --name portainer_agent --restart=always \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v /var/lib/docker/volumes:/var/lib/docker/volumes \
    portainer/agent:latest 2>/dev/null || true

  info "Warte auf Healthcheck (/ready, dann /health) ..."
  for i in $(seq 1 30); do
    if curl -s http://127.0.0.1:8080/ready 2>/dev/null | grep -q '"status":"ok"'; then
      ok "WaWi-Middleware ist online und gesund (/ready ok)!"
      break
    fi
    if curl -s http://127.0.0.1:8080/health 2>/dev/null | grep -q '"status"'; then
      # health antwortet auch wenn degraded — trotzdem break mit Hinweis
      warn "WaWi-Middleware antwortet auf /health, aber /ready noch nicht ok — pruefe DB/Redis"
      break
    fi
    sleep 1
  done

  ok "Docker Compose Stack erfolgreich aktiv!"
fi
