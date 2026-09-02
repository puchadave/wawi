# FullAutonom Business - Vollautonome Unternehmensführung

## Architektur-Überblick

Modulare Alpine-Linux-LXC-Architektur auf Proxmox-Cluster für eine komplett autonome Online-Unternehmensführung.

### Kernkonzept
- Jedes Geschäftsmodul = eigene Alpine Linux LXC
- Unabhängig agierend, untereinander vernetzt
- KI-gestützte Entscheidungsfindung via OSINT/SOCINT/HUMINT
- Automatische Marketing-Generierung & Content-Posting
- Autonome FiBu mit 10-Sekunden-Fremdkapital-Regel
- Nischenshop für Festival/DJ-Bekleidung (Uptempo, Hardcore, Raw, Hardstyle)

## LXC-Module (Proxmox)

| CT | Name | Port | Beschreibung |
|----|------|------|--------------|
| 100 | omniroute-ai | 20128 | KI-Gateway (14 OmniRoute Combos) |
| 101 | api-gateway | 8080 | Service Mesh, Auth, Rate-Limiting |
| 102 | crm-intel | 3001 | Kundenprofile, Social-Media-Profiling, OSINT/HUMINT |
| 103 | marketing-autopilot | 3002 | Auto-Content, Social-Posting, Lead-Generierung |
| 104 | ecommerce-core | 3003 | Shopware-Connector, Produkte, Bestellungen |
| 105 | fibu-autonomous | 3004 | FiBu, 10-Sek-Regel, Zahlungsabwicklung |
| 106 | logistics-hub | 3005 | Dropshipping, Lieferanten-APIs, Retouren |
| 107 | bi-brain | 3006 | Business Intelligence, Budget-Kalkulation |
| 108 | osint-engine | 3007 | Echtzeit-Recherche, Wettbewerber, Trends |
| 109 | data-lake | 5432/6379 | PostgreSQL 16, Redis 7, Zentraler Datenspeicher |

## Kommunikation

- **Synchron:** REST-APIs (192.168.176.0/24 VLAN)
- **Asynchron:** Redis PubSub + BullMQ Queues
- **BI-Feedback:** CT 107 sammelt Metriken → analysiert → sendet Optimierungen

## Tech Stack

- **Runtime:** Node.js 20 LTS + TypeScript 5.5
- **Datenbank:** PostgreSQL 16 + Redis 7
- **Queue:** BullMQ (Redis-basiert)
- **HTTP:** Fastify 4.x
- **KI:** OmniRoute AI Gateway (CT 100)
- **ORM:** Drizzle ORM
- **Validierung:** Zod

## Deployment

```bash
# Jedes Modul als eigenständiger Docker-Container
docker compose -f docker-compose.yml up -d

# Oder als Alpine Linux LXC auf Proxmox
./scripts/proxmox-deploy.sh
```

## Entwicklung

```bash
npm install
npm run dev          # Alle Module starten
npm run dev:crm      # Nur CRM starten
npm run dev:fibu     # Nur FiBu starten
npm run typecheck    # TypeScript-Prüfung
```
