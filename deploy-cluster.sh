#!/bin/sh
# WaWi Cluster & Middleware Deployment Script (Docker Compose & Swarm HA)
# Nutzung:
#   sh deploy-cluster.sh compose   (Standard Docker Compose)
#   sh deploy-cluster.sh swarm     (Docker Swarm HA Cluster)
set -e

MODE="${1:-compose}"

info() { echo "\033[1;34m[INFO]\033[0m $*"; }
ok()   { echo "\033[1;32m[OK]\033[0m $*"; }
err()  { echo "\033[1;31m[FEHLER]\033[0m $*" >&2; exit 1; }

cd "$(dirname "$0")"

info "Prüfe Docker Installation ..."
command -v docker >/dev/null 2>&1 || err "Docker ist nicht installiert."

if [ "$MODE" = "swarm" ]; then
  info "Starte Deployment im Docker Swarm Modus (High Availability) ..."
  
  # Swarm Status prüfen
  if ! docker info 2>/dev/null | grep -q "Swarm: active"; then
    info "Initialisiere Docker Swarm ..."
    docker swarm init || true
  fi

  info "Baue aktuelles WaWi-Middleware Image ..."
  docker build -t puchadave/wawi-middleware:latest .

  info "Deploye Stack 'wawi' ..."
  docker stack deploy -c docker-compose.swarm.yml wawi

  ok "Swarm Stack erfolgreich gestartet!"
  echo ""
  info "Services anzeigen: docker stack services wawi"
  info "Logs ansehen:      docker service logs -f wawi_wawi-middleware"

else
  info "Starte Deployment im Standard Docker Compose Modus ..."

  docker compose down --remove-orphans 2>/dev/null || true
  docker compose build
  docker compose up -d

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

echo ""
echo "================================================================"
echo "  WaWi Middleware — Zentraler Hub für Shopware 6 & Multichannel"
echo "================================================================"
echo "  Middleware API & Health: http://localhost:8080/api/health"
echo "  Admin Leitstand & Logs:  http://localhost:8080/admin.html"
echo "  Google Shopping XML Feed:http://localhost:8080/api/channels/google-shopping.xml"
echo "  Notfall Webshop:         http://localhost:8080/"
echo "================================================================"
