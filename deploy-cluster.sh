#!/bin/sh
# WaWi Cluster & Middleware Deployment Script (Docker Compose & Swarm HA)
# Nutzung:
#   sh deploy-cluster.sh compose   (Standard Docker Compose + Portainer Agent)
#   sh deploy-cluster.sh swarm     (Docker Swarm HA Cluster + Portainer CE Server)
set -e

MODE="${1:-swarm}"

info() { echo "\033[1;34m[INFO]\033[0m $*"; }
ok()   { echo "\033[1;32m[OK]\033[0m $*"; }
err()  { echo "\033[1;31m[FEHLER]\033[0m $*" >&2; exit 1; }

cd "$(dirname "$0")"

info "Prüfe Docker Installation ..."
command -v docker >/dev/null 2>&1 || err "Docker ist nicht installiert."

if [ "$MODE" = "swarm" ]; then
  info "Starte Deployment im Docker Swarm Modus (High Availability & Portainer CE) ..."
  
  # Swarm Status prüfen
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
  docker stack deploy -c docker-compose.swarm.yml wawi

  ok "Swarm Stack & Portainer Server erfolgreich gestartet!"
  echo ""
  echo "================================================================"
  echo "  PORTAINER SWARM LEITSTAND: https://localhost:9443  (oder :9000)"
  echo "  WAWI MIDDLEWARE API:       http://localhost:8080/api/health"
  echo "  WAWI ADMIN LEITSTAND:      http://localhost:8080/admin.html"
  echo "================================================================"

else
  info "Starte Deployment im Standard Docker Compose Modus ..."

  docker compose down --remove-orphans 2>/dev/null || true
  docker compose build
  docker compose up -d

  # Portainer Agent Container
  docker run -d -p 9001:9001 --name portainer_agent --restart=always \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v /var/lib/docker/volumes:/var/lib/docker/volumes \
    portainer/agent:latest 2>/dev/null || true

  info "Warte auf Healthcheck ..."
  for i in $(seq 1 30); do
    if curl -s http://127.0.0.1:8080/api/health | grep -q '"status":"ok"'; then
      ok "WaWi-Middleware ist online und gesund!"
      break
    fi
    sleep 1
  done

  ok "Docker Compose Stack erfolgreich aktiv!"
fi
