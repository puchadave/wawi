# shop-kern — Legacy LXC-Leichtgewichts-Alternative

> **Status: LEGACY — nicht produktiv.** Produktive Middleware ist `apps/api` (Fastify/Drizzle/Postgres/BullMQ) + `apps/web` (React Control Center).
> `shop-kern` bleibt als **autarke LXC-Alternative** für ressourcenarme Umgebungen erhalten, nutzt aber **eigene file-basierte Daten** (`shop-kern/data/*.json`) und **nicht** die `apps/api`-Postgres-DB. Inkonsistenz ist bewusst dokumentiert — kein Sync geplant.

## Warum Legacy?

- **Soll-Architektur (FINAL REVIEW 2026-09-07):** Headless Middleware — Matterhorn → Canonical → AI Pipeline → Validation/Approval → Shopware Sync. **Kein interner Webshop.**
- **Produktiv:** `apps/api` ist Single Source of Truth (DB: Postgres, Queue: BullMQ/Redis, Auth: Argon2id+JWT+CSRF, RBAC).
- **`shop-kern`:** Node-stdlib http-Server, file-basiert (`data/products.json`, `data/orders.json`, `data/config.json`), keine DB-Anbindung, eigene Marketplace-DryRun-Module (Kaufland/Otto/eBay) unter `modules/marketplace/*`. Wird nicht mehr weiterentwickelt.

## Wann shop-kern verwenden?

- LXC ohne Postgres/Redis, nur Demo/Offline-Betrieb.
- DryRun-Tests für Marketplace-Adapter (ohne echte Sync-Queue).

## Nicht verwenden für

- Produktiven Betrieb mit Shopware — immer `apps/api` + externer Shopware nutzen.
- Datenimport/AI-Pipeline — nur `apps/api` beherrscht `/api/admin/matterhorn/*`, `/api/admin/ai/*`, `/api/products/*`.

## Betrieb (falls dennoch benötigt)

```bash
node shop-kern/server.js 8080
# oder via deploy-lxc.sh auf Proxmox LXC
```

- Daten: `shop-kern/data/` (wird zur Laufzeit erzeugt, `data/README.md` beachten).
- Logs: `shop-kern/data/logs/wawi-*.log`.
- Admin-Key: `shop-kern/data/admin.key`.

## Abgrenzung zu apps/api

| Aspekt | `apps/api` (produktiv) | `shop-kern` (legacy) |
|---|---|---|
| DB | Postgres + Drizzle | JSON-Files |
| Queue | BullMQ/Redis | keine |
| Auth | Argon2id, JWT, RBAC | admin.key |
| Matterhorn | DB-gestützt + ImportJobs | file-basiert |
| AI | Pipeline + ai_providers/prompts | kein AI |
| Shopware | Sync-Queue + Mappings | DryRun Registry |

## Roadmap

- Kein Refactoring von `shop-kern` (Directive: kein Neubau).
- Bei Bedarf: `shop-kern` als reiner DryRun-Simulator weiterführen, aber nie als Ersatz für `apps/api` deployen.
