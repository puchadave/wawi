# WaWi Runbook — Betrieb, Diagnose, Incidents

Stand: 2026-09-09 — Middleware `apps/api` (Fastify/Drizzle/Postgres/BullMQ) + `apps/web` + `shop-kern` LEGACY. Kein interner Shop.

## 1) Normalbetrieb pruefen

```sh
sh deploy-cluster.sh health
# erwartet: /ready 200 {status: ok, db: ok, redis: ok, dbMs, redisMs}
#           /health 200 informativ
#           docker stack ps wawi + service ls

# E2E (setzt WAWI_ADMIN_PASSWORD voraus)
BASE_URL=http://127.0.0.1:8080 WAWI_ADMIN_PASSWORD=... sh scripts/e2e.sh
cat scripts/e2e.log

# Lastprobe
BASE_URL=http://127.0.0.1:8080 sh scripts/load.sh
cat scripts/load.log
```

`GET /api/admin/stats` und `/api/admin/health` (Bearer, `admin:read`) liefern zusaetzlich `latency {dbMs, redisMs}` + `queues {sync,stock,price,media,fee}` (BullMQ getJobCounts, failed counts extra). Jede Antwort traegt `x-request-id` (client-vorgebbar, sonst UUID).

## 2) Logs

```sh
sh deploy-cluster.sh logs                # Swarm: service logs wawi_wawi-middleware --tail 100
docker service logs wawi_wawi-middleware --tail 200 -f
docker service logs wawi_postgres --tail 100
docker service logs wawi_redis --tail 100
# Compose:
docker compose logs --tail 100 wawi-middleware
```

Dauer-Messung: `x-response-time` Header bzw. server log `durationMs`.

## 3) Incidents

### 3.1 /ready -> 503 (DB oder Redis down)

- `/ready` liefert 503 wenn `db !== ok` oder `redis !== ok` (Payload enthaelt db/redis + dbMs/redisMs + dbError/redisError pii-safe).
- Diagnose:
  ```sh
  curl -s http://127.0.0.1:8080/ready | python3 -m json.tool
  curl -s http://127.0.0.1:8080/health | python3 -m json.tool
  docker service ps wawi_postgres --no-trunc
  docker service ps wawi_redis --no-trunc
  docker exec wawi-postgres pg_isready -U ${POSTGRES_USER:-wawi} -d ${POSTGRES_DB:-wawi_db}
  docker exec wawi-redis redis-cli ping
  ```
- Massnahme: `docker service update --force wawi_postgres` / `wawi_redis`, dann Stack neu deployen: `docker stack deploy -c docker-compose.swarm.yml wawi`.

### 3.2 DB laeuft, aber /api/admin/stats langsam (p95 >800ms)

- `GET /api/admin/stats` misst `dbMs` pro Aufruf — bei >100ms pruefen:
  ```sh
  docker exec wawi-postgres psql -U wawi -d wawi_db -c "SELECT * FROM pg_stat_activity WHERE state != 'idle' LIMIT 20;"
  docker service logs wawi_wawi-middleware --tail 200 | grep -i "dbMs\|durationMs\|slow"
  BASE_URL=http://127.0.0.1:8080 sh scripts/load.sh  # p50/p95 pruefen
  ```
- Ursache oft: fehlender Index, grosse XML-Imports, BullMQ Backlog.

### 3.3 Queue stuck (BullMQ)

- `GET /api/admin/stats` -> `queues.*.pending` bzw. `GET /api/admin/health` -> queue depths.
- Diagnose:
  ```sh
  curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8080/api/admin/shopware/queue | python3 -m json.tool
  curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8080/api/admin/shopware/status | python3 -m json.tool
  ```
- Retry: `POST /api/products/:id/sync/retry` (public) oder `POST /api/admin/shopware/queue/:id/retry` (shopware:write).
- BullMQ: Queues sind `syncQueue`, `stockQueue`, `priceQueue`, `mediaQueue`, `feeQueue` — `getJobCounts("waiting","active","failed")` wird best-effort abgefragt, Redis-Ausfall fuehrt nicht zum 500 von /stats.

### 3.4 Shopware 429 / 5xx

- Sync nutzt `stableHash` + `syncHashes`/`syncAttempts` + Dedupe — bei 429 wird der Job via BullMQ mit Backoff neu eingeplant (siehe `apps/api/src/shopware/sync.ts`).
- Pruefen: `GET /api/admin/shopware/attempts` (letzte Versuche), dann manueller Retry wie oben.
- Wenn `SHOPWARE_API_URL` leer: Sync wird nur gezaehlt/enqueued, kein Push — das ist erwartetes Verhalten (DryRun), kein Fehler.

### 3.5 Import schlaegt fehl (400 bad_xml, oversize)

- `POST /api/import/upload` akzeptiert nur `.xml`, max 50MB, `sax` Stream.
- Bei `400 bad_xml`: XML mit `xmllint --noout file.xml` pruefen, Fixture aus `scripts/e2e.sh` (e2e-1001/e2e-1002) als Referenz nutzen.
- Bei grossen Dateien: in 50MB-Chunks splitten, nacheinander hochladen.

### 3.6 Auth / Bootstrap

- Erster Admin wird via `apps/api/src/auth/bootstrap.ts` angelegt: `WAWI_ADMIN_USERNAME` + `WAWI_ADMIN_PASSWORD_HASH` (bevorzugt) oder `WAWI_ADMIN_PASSWORD` (Argon2id, plain nie persistiert).
- Passwort-Regel: >=12 Zeichen, je 1x Gross-/Kleinbuchstabe, Ziffer, Sonderzeichen. Login: `POST /api/auth/login` -> `accessToken`.

## 4) Backup / Restore / Rollback

```sh
# Backup
docker exec wawi_postgres pg_dump -U ${POSTGRES_USER:-wawi} ${POSTGRES_DB:-wawi_db} > backup-$(date +%F).sql
# Restore
cat backup-*.sql | docker exec -i wawi_postgres psql -U ${POSTGRES_USER:-wawi} ${POSTGRES_DB:-wawi_db}

# Rollback Image (Swarm)
docker service update --image puchadave/wawi-middleware:<prev-tag> wawi_wawi-middleware
# Compose
docker compose build && docker compose up -d

# Migrationen (Drizzle, 0000..0006, zuletzt products.attributes jsonb)
# Vor Deploy: npm run typecheck && npm run build lokal pruefen
```

## 5) ZeroTier-Planet (optional Fallback-Mesh)

Nur wenn `ZEROTIER_NETWORK_ID` gesetzt, deployt `deploy-cluster.sh` zusaetzlich `docker-compose.zerotier.yml` (Service `zerotier`, `cap_add NET_ADMIN/SYS_ADMIN`, `/dev/net/tun`, Swarm `mode: global`). `wawi-overlay` bleibt primaeres Netz — `wawi-middleware` laeuft nie in `network_mode: host`. Ohne Variable wird die Datei ignoriert.

```sh
ZEROTIER_NETWORK_ID=<id> sh deploy-cluster.sh swarm
# oder manuell:
docker stack deploy -c docker-compose.swarm.yml -c docker-compose.zerotier.yml wawi
docker service logs wawi_zerotier --tail 50
zerotier-cli listnetworks  # im Container: docker exec $(docker ps -q -f name=zerotier) zerotier-cli listnetworks
```

## 6) Checkliste Go-Live (08:00)

- [ ] `npm run typecheck && npm run build` gruen (api+web)
- [ ] `sh deploy-cluster.sh health` -> /ready 200, docker stack ps healthy
- [ ] `BASE_URL=... WAWI_ADMIN_PASSWORD=... sh scripts/e2e.sh` -> FAIL=0
- [ ] `sh scripts/load.sh` -> p95 <800ms (Richtwert), 0 Fehler ausser 429
- [ ] `GET /api/admin/stats` -> byStatus/total plausibel, keine stuck queues
- [ ] Shopware extern erreichbar (wenn konfiguriert) oder bewusst DryRun
- [ ] Backup gezogen, Rollback-Tag bekannt
- [ ] Portainer https://<IP>:9443 erreichbar, Stack `wawi` + `portainer` gruen

## 7) Kontakt / Referenzen

- `README.md` — Architektur, Env-Tabelle, Endpoints, Observability
- `docs/ARCHITECTURE_AUDIT.md` — Soll/Ist, shop-kern LEGACY Begruendung
- `shop-kern/README.md` — LEGACY-Marker (file-based vs. DB)
- `.hermes/plans/2026-09-09_073000-phase-7-final-test-go-live.md` — Phase-7 Plan
