#!/bin/bash
# FO-Business Start Script
# Startet alle Server-Module parallel auf dem Workstation

set -e

echo "============================================"
echo "  FO-Business Server Start"
echo "  0€-Budget Dropship-System"
echo "  Festival/DJ-Bekleidung"
echo "============================================"
echo ""

if ! command -v node &> /dev/null; then
  echo "ERROR: Node.js not found. Please install Node.js >= 20"
  exit 1
fi

NODE_VERSION=$(node -v)
echo "Node.js: $NODE_VERSION"

if [ ! -f .env ]; then
  echo "WARNING: .env file not found. Creating from .env.example..."
  cp .env.example .env
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

echo ""
echo "Starting modules..."
echo ""

MODULES=(
  "modules/api-gateway:8080:API-Gateway"
  "modules/crm-intel:3001:CRM-Intel"
  "modules/marketing-autopilot:3002:Marketing-Autopilot"
  "modules/ecommerce-core:3003:Ecommerce-Core"
  "modules/fibu-autonomous:3004:Fibu-Autonomous"
  "modules/logistics-hub:3005:Logistics-Hub"
  "modules/bi-brain:3006:BI-Brain"
  "modules/osint-engine:3007:OSINT-Engine"
  "modules/data-lake:3008:Data-Lake"
)

PIDS=()

for mod in "${MODULES[@]}"; do
  IFS=: read -r dir port name <<< "$mod"
  echo "Starting $name on port $port..."
  (cd "$dir" && npx tsx src/index.ts) &
  PIDS+=($!)
  sleep 0.5
done

echo ""
echo "============================================"
echo "  All modules started!"
echo "  API-Gateway: http://localhost:8080"
echo "  CRM-Intel: http://localhost:3001"
echo "  Marketing: http://localhost:3002"
echo "  Ecommerce: http://localhost:3003"
echo "  FiBu: http://localhost:3004"
echo "  Logistics: http://localhost:3005"
echo "  BI-Brain: http://localhost:3006"
echo "  OSINT: http://localhost:3007"
echo "  Data-Lake: http://localhost:3008"
echo "============================================"
echo ""
echo "Press Ctrl+C to stop all modules"

trap 'echo "Stopping all modules..."; kill "${PIDS[@]}" 2>/dev/null; exit 0' INT TERM
wait
