# WaWi Middleware — AI-gestuetzte Warenwirtschaft (ohne internen Shop)

WaWi ist eine **Middleware** (kein Shop): Matterhorn XML -> Canonical Model -> konfigurierbare AI-Pipeline -> Freigabe -> Sync in eine **externe Shopware-6-Instanz**. Kein interner Shop, kein Cart/Checkout/Payment. `shop-kern/` ist LEGACY (file-based, nur noch DryRun fuer Marketplace-Adapter) — produktiv ist `apps/api` (Fastify + Drizzle/Postgres + BullMQ/Redis) + `apps/web` (Split Control Center).

```
Matterhorn (XML) -> Import Adapter (sax stream) -> Canonical products/variants (Postgres)
                                              -> AI Pipeline (aiData) -> manualData Overlay -> reviewed -> approved
                                                                                           -> Shopware Sync (stableHash, syncHashes/syncAttempts, Dedupe/Retry, BullMQ) -> externer Shopware (OAuth2)
```

## Schnellstart

```sh
# Swarm HA + Portainer (Standard, pve04)
sh deploy-cluster.sh swarm

# Standard Compose (ohne Swarm)
sh deploy-cluster.sh compose

# ZeroTier-Planet als Fallback-Mesh (optional, nur zusaetzliches Overlay)
ZEROTIER_NETWORK_ID=<id> sh deploy-cluster.sh swarm

# Diagnose
sh deploy-cluster.sh health
sh deploy-cluster.sh logs

# E2E-Kette (setzt WAWI_ADMIN_PASSWORD voraus)
BASE_URL=http://127.0.0.1:8080 WAWI_ADMIN_PASSWORD=... sh scripts/e2e.sh

# Lastprobe (keine neue Dep)
BASE_URL=http://127.0.0.1:8080 sh scripts/load.sh
```

Ports: Middleware `8080` (`WAWI_PORT` env), Portainer `9443`/`9000`. `shop-kern` (LEGACY) laeuft nicht mehr als Shop — 410 fuer Storefront.

## Umgebung

Kopiere `.env.example` nach `.env` und setze Secrets **nie** ins Repo. `docker-compose.yml`/`docker-compose.swarm.yml` lesen env mit Defaults fuer lokale Entwicklung; produktiv via Swarm Secrets/Portainer env.

| Variable | Pflicht | Beschreibung |
|---|---|---|
| `DATABASE_URL` | ja | `postgresql://USER:PASS@postgres:5432/DB` — im Compose aus `POSTGRES_USER/PASSWORD/DB` gebaut |
| `REDIS_URL` | ja | `redis://redis:6379` |
| `SHOPWARE_API_URL` | optional | Externe Shopware-Instanz (ohne => Sync enqueued, aber kein Push; DryRun) |
| `SHOPWARE_CLIENT_ID` / `SHOPWARE_CLIENT_SECRET` | bei Shopware | OAuth2 Client |
| `WAWI_ADMIN_USERNAME` / `WAWI_ADMIN_EMAIL` | beim Bootstrap | Erster Admin — wird via `apps/api/src/auth/bootstrap.ts` angelegt |
| `WAWI_ADMIN_PASSWORD` | alternativ zu Hash | Klartext nur fuer Bootstrap, sofort Argon2id-gehasht abgelegt |
| `WAWI_ADMIN_PASSWORD_HASH` | bevorzugt | Argon2id-Hash (nie Klartext im Repo) |
| `WAWI_PORT` | nein | Host-Port fuer 8080-Mapping (default 8080) |
| `ZEROTIER_NETWORK_ID` | nein | Wenn gesetzt, wird `docker-compose.zerotier.yml` zusaetzlich deployed |
| `NODE_ENV` / `PORT` / `HOST` | nein | `production`/`8080`/`0.0.0.0` |

Passwort-Regel (BSI Grundschutz): **>=12 Zeichen, je 1x Gross-/Kleinbuchstabe, Ziffer, Sonderzeichen**. `bootstrap.ts` erzwingt Hash via Argon2id, plain wird nie gespeichert.

## Endpoints

### Health / Readiness (ohne Auth)

- `GET /health` — informativ: `{ status: ok|degraded, db, redis, dbMs, redisMs, queues, shopwareConfigured }`, immer 200.
- `GET /ready` — Swarm/Docker Readiness: **200 nur wenn DB+Redis ok**, sonst **503** (identisches Payload wie /health fuer Debugging).
- `GET /api/health` — Legacy-Compat fuer shop-kern (`/api/health`), von Middleware ebenfalls bedient (faellt auf /health zurueck falls noetig).

Docker HEALTHCHECK (root `Dockerfile`, `apps/api/Dockerfile`, beide Compose-Files):
`curl -sf http://127.0.0.1:8080/ready || curl -sf http://127.0.0.1:8080/health || curl -sf http://127.0.0.1:8080/api/health`

### Auth

- `POST /api/auth/login` -> `{ accessToken, user }` (Bearer fuer `/api/admin/*`)

### Admin / Middleware (Bearer, perms `admin:read`, `shopware:read`, etc.)

- `GET /api/admin/stats` — Produkte (byStatus+total), Varianten, ImportJobs, aiProcessingRuns, syncAttempts, shopwareMappings, integrations, `latency {dbMs, redisMs}` + `queues {sync,stock,price,media,fee}` (BullMQ getJobCounts best-effort) + generatedAt
- `GET /api/admin/health` — wie /health plus queue-Tiefen mit Latenz, shopwareConfigured-Flag

### Produkte (teils public)

- `GET /api/products?limit=&search=&status=` — Liste (public)
- `GET /api/products/:id` — Detail (public, inkl. attributes jsonb)
- `PATCH /api/products/:id/manual-data` — Titel/Meta-Overlay (public)
- `PATCH /api/products/:id/attributes` — `attributes` jsonb, max 100 Keys, `null` loescht Key (public)
- `POST /api/products/:id/review` / `POST /api/products/:id/approve` — Freigabe (public, status -> reviewed/approved)
- `POST /api/products/:id/sync/retry` — Shopware Sync neu anstossen (public, queue oder direkter Sync je nach SHOPWARE_API_URL)
- `POST /api/import/upload` — multipart `file` (nur `.xml`, 50MB) -> Matterhorn stream -> upsert

### Shopware

- `GET /api/admin/shopware/status | /queue | /mappings | /attempts` (shopware:read)
- `POST /api/admin/shopware/queue/:id/retry` (shopware:write)

Weiter: `/api/admin/matterhorn/*`, `/api/admin/ai/*`, `/api/admin/integrations` — siehe `apps/api/src/routes/`.

## Observability (kontinuierliches Debugging)

- `x-request-id` — jeder Request erhaelt `x-request-id` (Client kann vorgeben, sonst `crypto.randomUUID()`), via `onRequest` Hook gesetzt und im `reply.header` zurueckgegeben. `x-response-time` bzw. `durationMs` wird geloggt.
- `GET /api/admin/stats` misst `dbMs` (SELECT 1) und `redisMs` (PING) pro Aufruf — kein zusaetzlicher Exporter noetig.
- Logs: `sh deploy-cluster.sh logs` (Swarm: `docker service logs wawi_wawi-middleware --tail 100`).

## Tests

Ohne neue npm-Deps (nur curl+python3, BSI-konform):

- `sh scripts/e2e.sh` — 13 Schritte: health/ready, login, stats/health, products, Matterhorn fixture upload (e2e-1001/e2e-1002), manualData, attributes, review/approve, sync/retry, shopware queue/status, matterhorn/ai/integrations. Exit 0 bei FAIL=0 (SKIP erlaubt fuer optionale Shopware-Schritte), non-zero nur bei echtem FAIL. `BASE_URL`, `WAWI_ADMIN_USERNAME/PASSWORD`, `LOG_FILE` env.
- `sh scripts/load.sh` — `REQUESTS=50 CONCURRENCY=20 GET /api/products?limit=20` parallel via `xargs -P`, p50/p95/p99 + 429-Verteilung, Richtwert p95 <800ms.

Beide schreiben nach `scripts/e2e.log` bzw. `scripts/load.log`.

## Backup / Restore / Rollback

- Backup Postgres: `docker exec wawi-postgres pg_dump -U ${POSTGRES_USER:-wawi} ${POSTGRES_DB:-wawi_db} > backup.sql`
- Restore: `cat backup.sql | docker exec -i wawi-postgres psql -U ${POSTGRES_USER:-wawi} ${POSTGRES_DB:-wawi_db}`
- Rollback Middleware-Image: `docker service update --image puchadave/wawi-middleware:<prev-tag> wawi_wawi-middleware` (Swarm) oder `docker compose build && docker compose up -d` (Compose)
- Migrationen: `apps/api/drizzle/` (0000..0006, zuletzt `products.attributes` jsonb), via `drizzle-kit`/`drizzle` — vor Deploy `npm run build` lokal pruefen.

## ZeroTier-Planet (optional)

Fuer Swarm-Erreichbarkeit bei externem Netz-Ausfall. Nur wenn `ZEROTIER_NETWORK_ID` gesetzt, deployt `deploy-cluster.sh` zusaetzlich `docker-compose.zerotier.yml` (Service `zerotier`, `cap_add NET_ADMIN/SYS_ADMIN`, `/dev/net/tun`, global im Swarm). `wawi-overlay` bleibt primaeres Netz — die Middleware selbst laeuft **nie** in `network_mode: host`. Ohne Variable wird die Datei ignoriert.

## Hinweise

- Kein interner Shop: Storefront/Checkout/Payment sind entfernt, Routen liefern 410.
- Secrets nur via env, nie Klartext im Repo. AI-Provider-Keys als env-Var-Referenz (`apiKeyEnvVar`) in DB, nie plain.
- `typecheck` + `build` muessen vor jedem Push gruen sein (`npm run typecheck && npm run build` — api + web).
- Shopware ist immer extern; `SHOPWARE_API_URL` leer => Sync wird enqueued/gezaehlt, aber nicht gepusht.
- `shop-kern/README.md` markiert das alte System als LEGACY — produktiv ist `apps/api`.
