# Plan: Kaufland & Otto API-Anbindung (plus eBay/Kleinanzeigen komplett) — shop-kern WaWi

Datum: 2026-09-06
Basis: mapper.js + catalog pricingDetailsByPlatform/channelPrices + pricing.js platformFees sind bereits live (commit 0b53816). Naechster Schritt: echte Marktplatz-Adapter mit API-Sync, Bestand/Preis-Push, Bestellimport, Tracking-Rueckspielung, Rate-Limit/Retry, Secrets.

## Ziel
WaWi wird zentrale Middleware: Matterhorn-XML -> normalizeMatterhornToWaWi -> catalog -> pricing per Plattform -> mapper -> Push zu Shopware/eBay/Kleinanzeigen/Kaufland/Otto (Listing), laufender Stock/Preis-Sync, Order-Import (inkl. Zuordnung auf WaWi-Variante/EAN), Status-/Tracking-Sync, einheitliche Debug/Telemetrie.

## Leitplanken (verbindlich)
- Keine zusaetzlichen Service-Container: alles in `shop-kern` (Node stdlib only, dependency-frei).
- Shop ist externe Shopware-Instanz, WaWi verwaltet sie (bestehender shopware/sync.ts bleibt Referenz, shop-kern bleibt Master).
- Kontinuierliches Debugging vorgeschrieben: logger + Telemetrie in jedem Modul, keine stillen Fehler.
- BSI-Grundschutz: jede Aenderung sofort einzeln committen+pushen.

## Ist-Zustand (verifiziert)
- `pricing.js:calculateProductPrice(input, platformFees)` mit fixedFee/percentageFee -> effektive Marge, getestet (ebay 11%+0.35, otto 15%).
- `catalog.js:applyPricingRule(rule, productId, platformFees)` speichert `pricingDetailsByPlatform`/`channelPrices`.
- `mapper.js` komplett: WaWi <-> Shopware/Google/eBay/Kleinanzeigen/Kaufland/Otto/Facebook mit allen Feldern/Optionen, E2E verifiziert.
- `server.js`: marketplaceFees Defaults, pricing/calculate+apply per platform, XML-Import via mapper, unified `/api/admin/channels/map|export/:channel`, 6 Modul-Tests gruen.
- `marketplace/` Verzeichnis existiert, leer.

## Architektur-Entscheid: BaseAdapter + 4 Adapter
```
shop-kern/modules/marketplace/
  base.js        -- HMAC/fetch, retry/backoff, rate-limit, dryRun, logger, Secrets via config.json + env Fallback
  kaufland.js    -- Kaufland Marketplace API (Seller API v2): offer upsert, stock/price, orders
  otto.js        -- Otto Market API (Partner API): product/offer, stock, orders, shipment
  ebay.js        -- eBay Sell APIs (Inventory + Fulfillment): inventoryItem, offer, order
  kleinanzeigen.js -- Kleinanzeigen: offiziell keine stabile Seller-API -> Adapter als "listing-export + headless-bridge" (CSV/Feed + optional Playwright-Bridge, dryRun default)
  registry.js    -- kanal-uebergreifend: pushProduct(channel,id), syncAll(), importOrders(channel), pushTracking()
```

Warum BaseAdapter: alle 4 Kanaele teilen Retry, HMAC-Signatur (Kaufland), OAuth (Otto/eBay), Idempotenz, Dry-Run, Telemetrie. Kein Copy-Pasta.

## API-Recherche (vor Coding verifizieren, Docs pinnen)
- Kaufland: Seller API docs `sellerapi.kaufland.com` — Endpunkte `POST /v2/offers`, `PUT /v2/offers/{id}`, `GET /v2/orders`, `PUT /v2/orders/{id}/status`. Auth: API-Key + HMAC-SHA256 Timestamp. Rate limit ~ 2 req/s -> Token Bucket.
- Otto: `api.otto.market` — OAuth2 Client Credentials, `POST /v1/products`, `PATCH /v1/products/{sku}/stock`, `GET /v1/orders`, `POST /v1/shipments`. Sandbox vs Prod via config.
- eBay: `api.ebay.com/sell/inventory/v1` + `sell/fulfillment/v1` — OAuth2, Inventory Location zuerst, dann `inventory_item`, `offer`, `publish`.
- Kleinanzeigen: keine offizielle Seller-API -> Adapter bietet `exportListing(product) -> payload` + `dryRun` + optional `POST /bridge/publish` fuer externen Headless-Worker (ausserhalb shop-kern scope, nur Schnittstelle).

## Secrets & Config (kein hardcoded Secret)
`shop-kern/data/config.json` erweitern (Defaults, leer):
```json
{
  "marketplaceFees": { "ebay": {"fixedFee":0.35,"percentageFee":0.11}, ... },
  "marketplace": {
    "kaufland": { "enabled": false, "mode": "dryRun", "apiKey": "", "secret": "", "clientKey": "", "baseUrl": "https://sellerapi.kaufland.com/v2" },
    "otto":     { "enabled": false, "mode": "dryRun", "clientId": "", "clientSecret": "", "baseUrl": "https://api.otto.market/v1", "tokenUrl": "https://api.otto.market/v1/token" },
    "ebay":     { "enabled": false, "mode": "dryRun", "clientId": "", "clientSecret": "", "refreshToken": "", "baseUrl": "https://api.ebay.com" },
    "kleinanzeigen": { "enabled": false, "mode": "dryRun", "bridgeUrl": "" }
  }
}
```
Env-Fallback: `KAUFLAND_API_KEY/SECRET`, `OTTO_CLIENT_ID/SECRET`, `EBAY_CLIENT_ID/SECRET`. Beim Lesen: config > env. Secrets nie loggen (maskiert).

## Dateien & Aenderungen (konkret)
1. `shop-kern/modules/marketplace/base.js` — `class MarketplaceBase { constructor(channel, catalogManager, getConfig) ... }` mit `request(method, path, body, opts)`, `withRetry(fn)`, `rateLimit()`, `isDryRun()`, `maskSecret()`.
2. `shop-kern/modules/marketplace/kaufland.js` — `class KauflandAdapter extends MarketplaceBase` Methoden: `pushProduct(productId)`, `pushStock(productId)`, `pushPrice(productId)`, `importOrders(since)`, `pushTracking(orderId, tracking)`, `healthCheck()`. Verwendet `mapper.mapWaWiToKaufland()`.
3. `shop-kern/modules/marketplace/otto.js` — analog, plus `ensureProduct()` (Otto verlangt Produktanlage vor Offer).
4. `shop-kern/modules/marketplace/ebay.js` — Inventory Location Handling, `createOrUpdateInventoryItem()`, `createOffer()`, `publishOffer()`, `importOrders()`.
5. `shop-kern/modules/marketplace/kleinanzeigen.js` — `generatePayload()` via mapper, `exportBatch()`, `publishViaBridge()` (nur wenn bridgeUrl gesetzt, sonst dryRun + Anleitung).
6. `shop-kern/modules/marketplace/registry.js` — `pushProduct(channel,id)`, `pushStockAll()`, `importOrdersAll()`, `getStatus()`.
7. `shop-kern/server.js` — neue Endpunkte:
   - `GET /api/admin/marketplace/status` — pro Kanal enabled/mode/letzter Sync/Fehler
   - `POST /api/admin/marketplace/:channel/push {id|ids}` — Listing pushen
   - `POST /api/admin/marketplace/:channel/sync-stock {id|ids}` — Stock/Preis pushen
   - `POST /api/admin/marketplace/:channel/import-orders {since}` — Order-Import -> OrderManager
   - `POST /api/admin/marketplace/:channel/tracking {orderId,trackingNumber,carrier}` — Tracking rueckspielen
   - `POST /api/admin/marketplace/sync-all {channels:[]}` — alle Kanaele
   - `GET /api/admin/marketplace/:channel/health` — Dry-Run Healthcheck
8. `shop-kern/test/wawi_modules_test.js` — erweitern um Suite 7: Mapper + Base Retry + DryRun Push (mit Mock-fetch, keine echten API-Calls).
9. `shop-kern/data/README.md` (optional) — Doku Secrets/Modi.

## Reihenfolge (inkrementell, je Schritt commit+push)
- Schritt 1: `base.js` + `registry.js` Skeleton + `server.js` Status/Health Endpunkte (ohne echte API-Calls) — Test DryRun gruen.
- Schritt 2: `kaufland.js` + `otto.js` voll (inkl. HMAC/OAuth Stub + DryRun) — Stock/Preis/Order-Mapping via mapper, Tests mit Mock.
- Schritt 3: `ebay.js` + `kleinanzeigen.js` — eBay Inventory-Flow, Kleinanzeigen Export/Bridge.
- Schritt 4: `server.js` restliche Endpunkte + Order-Import -> `OrderManager.createOrder()` + Bestandsabzug via `catalog.adjustStock()` + DRY Telemetry.
- Schritt 5: E2E mit DryRun gegen lokale Fixtures (kein externes Netz noetig), alle Tests gruen, Doku.

## Tests & Validierung
- Unit: `node shop-kern/test/wawi_modules_test.js` + neue Suite 7 (Mock-fetch, DryRun-Push fuer jeden Kanal, Retry/Backoff).
- Syntax: `node --check` alle Module.
- E2E DryRun: `POST /api/admin/marketplace/kaufland/push {id}` mit `mode:dryRun` -> loggt Payload, schreibt `data/marketplace_dryrun.log`, kein Netz.
- Prod: Health-Endpoint zeigt `enabled:false` bis Secrets gesetzt; kein autom. Push ohne `enabled:true`.

## Risiken & Mitigation
- Kaufland HMAC falsch -> 401: Base-Tests mit bekanntem Testvektor, Zeit-Drift via NTP, Signatur-Logging (maskiert).
- Otto OAuth Refresh -> 401: Token-Cache mit TTL, Auto-Refresh vor Ablauf.
- eBay Inventory Location Pflicht -> leerer Katalog: Adapter legt `inventory_location` deterministisch an (`shop-kern` hostname).
- Kleinanzeigen keine API: klar als Export/Bridge dokumentieren, kein "Fake-API".
- Rate Limits: Token-Bucket pro Kanal (Kaufland 2/s, Otto 5/s, eBay 5k/d), Retry 429 mit Retry-After.
- Secrets im Repo: config.json gitignored fuer Secrets? -> Defaults leer committen, echte Werte nur lokal/env.

## Offene Fragen (vor Step 2 klaeren)
- Kaufland/Otto Sandbox-Credentials vorhanden? Falls nein, DryRun bleibt Default.
- Welche Kategorien fuer Kaufland/Otto Mapping priorisieren? (aus WaWi categoryPath)
- eBay Kategorien-Mapping Country=DE vorausgesetzt?
