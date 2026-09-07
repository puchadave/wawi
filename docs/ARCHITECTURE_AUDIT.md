# Architecture Audit — WaWi Middleware vs. Internal Webshop (2026-09-06)

Status: CRITICAL CORRECTION — `THERE IS NO INTERNAL WEBSHOP`

## 1. Scope
Geprüft: `shop-kern/` (v2.3 file-based Middleware + Storefront), `apps/api/` (Fastify + Drizzle/Postgres Middleware), `apps/web/` (React Admin), `packages/shared/`, `wawi-installer/wawi.sh`, `shop-kern/deploy-lxc.sh`.

Ziel-Soll (Directive):
```
Matterhorn → Matterhorn Import Adapter → Canonical Product Model → AI Pipeline → Validation → Approval → Shopware Mapper → ShopwareClient → External Shopware
```
Web-Interface = reines **WaWi Control Center** (Admin), niemals Storefront.

## 2. Befund — Korrekt vs. Fehlarchitektur

### 2.1 apps/api — KORREKT (Referenz-Implementierung)
- `src/schema.ts`: `products` (supplierProductId PK, aiData/manualData, status imported/reviewed/approved/synced/rejected, isWhitelisted), `variants`, `shopwareMappings`, `syncAttempts`, `syncHashes`, `users/audit`. Decoupled canonical model. **KEEP**.
- `src/xmlParser.ts`: `parseMatterhornXmlStream` via sax, tokenizer → `MatterhornProduct`. Adapter-Pattern korrekt. **KEEP**.
- `src/importer.ts`: `upsertProduct(MatterhornProduct)` → canonical `products` + `variants`, whitelist-gated. Korrekte Adapter-Grenze. **KEEP**.
- `src/shopware/{client.ts,sync.ts}`: `ShopwareClient`, `ShopwareAuthenticator`, `syncProductToShopware` mit `shopwareId(uuidv5)`, `stableHash`, `syncAttempts/syncHashes`, `effectiveContent(manualData>aiData>source)`. Dedizierter Sync-Layer. **KEEP**.
- `src/routes/products.ts`: Admin-only Produktverwaltung mit `status` Workflow + `manualData` Override, kein Cart/Checkout. **KEEP**.
- `src/queues.ts`: `stockQueue/priceQueue/syncQueue/mediaQueue/feeQueue` + Worker. **KEEP**.
- `src/index.ts`: Fastify mit helmet/cors/rateLimit/cookie, kein Storefront-Serve. **KEEP**.
- `packages/shared/src/types/product.ts`: `MatterhornProduct` → `WaWiProduct{matterhornData, aiData, manualData, status}` — canonical Trennung. **KEEP**.

Defizit in apps/api (zu schließen):
- AI Pipeline nur rudimentär (`aiData` vorhanden, aber kein `ai/processors`, `TransformationPipeline`, `ProductProcessor` Interface). — **REFACTOR/EXTEND** per Directive Kap. 3-4.
- Approval-Modus `Automatic/Manual/Approval Required` noch nicht konfigurierbar — **REFACTOR**.
- Sync-States `NOT_SYNCED/QUEUED/SYNCING/SYNCED/FAILED/RETRYING/CONFLICT` nur teilweise (`syncAttempts.status`). — **REFACTOR**.
- Traceability `OriginalValue→ModifiedValue + processor/model/prompt/timestamp` fehlt. — **REFACTOR**.

### 2.2 apps/web — KORREKT (Admin Control Center), kein Shop
- `App.tsx` Layout `WaWi Middleware` + `ProductList`/`ProductDetail` + `Login`/`Admin` — kein Cart/Checkout. **KEEP**.
- Erwartet Korrektur: Tabs müssen Soll-Navigation abbilden: Dashboard / Products / Imports / AI Engine / Shopware / Logs / Settings. Derzeit nur Products + Admin. **REFACTOR** (Navi erweitern).

### 2.3 shop-kern — TEILS KORREKT, ENTHÄLT FEHLARCHITEKTUR WEBSHOP
**KEEP (Middleware-Kern):**
- `modules/xmlparser.js` — Matterhorn Adapter (KEEP, bereits auf Canonical via `mapper.js` gebracht)
- `modules/mapper.js` — `normalizeMatterhornToWaWi` + `mapWaWiTo{Shopware,Google,Ebay,…}` — Kern der Canonical→Shopware Trennung. **KEEP**.
- `modules/pricing.js` — `calculateProductPrice` (EK→VK inkl. platformFees). Domänenlogik Middleware. **KEEP**.
- `modules/catalog.js` — File-based `CatalogManager` (products.json). Ersetzt in Prod durch DB, aber als light-Middleware valide. **KEEP** (muss Status-Workflow erweitern).
- `modules/logger.js`, `modules/analytics.js`, `modules/marketplace/{base,kaufland,otto,ebay,kleinanzeigen,registry}.js` — alle externer Channel-Adapter, nicht interner Shop. **KEEP** (Adapter bleiben modular, Shopware bleibt primär).
- `server.js` Teil: `POST /api/admin/catalog/import-xml`, `/api/admin/pricing/*`, `/api/admin/channels/map|export`, `/api/admin/marketplace/*`, `/api/admin/debug/*`, `/api/admin/config` (soweit nicht storefront). **KEEP**.
- `public/admin.html` — Leitstand. **REFACTOR** zu Soll-Navi (Dashboard/Products/Imports/AI/Shopware/Logs/Settings), Storefront-Links entfernen.

**REMOVE (Internal Webshop — verletzt CRITICAL RULE):**
- `public/index.html` — `Uptempo Store — Festival & Hardcore Merch`, `productGrid`, `categoryFilters`, Kunden-Produktkatalog. **REMOVE** (kein customer-facing Katalog).
- `public/shop.js` — `cart=localStorage wawi-cart`, `addToCart`, `saveCart/renderCart`, `waLink` Checkout, `categoryFilters/search` Storefront. **REMOVE** (kein Warenkorb/Checkout).
- `public/style.css` Storefront-Teile ( `.search-filter-bar`, `.filter-btn`, `.badge-in-stock`, `.footer` Storefront) — **REFACTOR** (nur Admin-Styles behalten).
- `server.js` Public Storefront Routen:
  - `GET /api/products` (activeOnly public) — Kunden-Katalog **REMOVE** (ersetzen durch `GET /api/admin/products` auth)
  - `GET /api/config` public (shopName/whatsapp/paypal) — **REMOVE** (Shop-Config gehört nicht in public)
  - `POST /api/orders` — `Warenkorb ist leer`, `Lieferadresse unvollständig`, `prod.price * quantity`, `createOrder` Kunden-Bestellung — **REMOVE** (Bestellungen = Shopware, nicht interne Checkout)
  - `servePublic` für `/` → `index.html` Storefront — **REFACTOR** → `/` → redirect/admin only, kein Storefront.
  - Payment-Config `paypalLink/stripePaymentLink/paymentMethod` in `ensureDataFiles`/`readConfig`/`POST /api/admin/config` — **REMOVE**.
- `modules/orders.js` — `OrderManager.createOrder(customer{street,zip,city}, DHL tracking)` als interne Kundenbestellung — **REFACTOR**: nicht löschen (Logik nützlich), aber umwidmen zu `ShopwareOrderMirror` (nur gespiegelte Shopware-Orders, kein interner Checkout). Oder als `syncAttempts`-ähnlich markieren. Klassifikation: **REFACTOR** (entkoppeln von Storefront).
- `modules/channels.js` Teile `generateFacebookListing` Storefront-ähnlich — **REFACTOR** (bleibt als externer Feed, aber nicht als Storefront-Ersatz; echte Feeds sind Shopware-Sache).
- `server.js` `seedProducts()` mit Demo-Shop-Artikeln `UT-001` — **REMOVE** (kein Demo-Shop).

**Bewahrungsregel:** Nicht löschen, wenn Wort `product` vorkommt. Nur `Storefront/Cart/Checkout/Payment/CustomerLogin` entfernen.

## 3. Klassifikationstabelle

| Komponente | Pfad | Urteil | Begründung |
|---|---|---|---|
| Canonical Model | `apps/api/src/schema.ts`, `packages/shared/types/product.ts`, `shop-kern/modules/mapper.js` | KEEP | Trennung Matterhorn→Canonical→Shopware bereits korrekt |
| Import Adapter | `apps/api/src/xmlParser.ts`, `apps/api/src/importer.ts`, `shop-kern/modules/xmlparser.js` | KEEP | Adapter vorhanden |
| Pricing | `shop-kern/modules/pricing.js`, `packages/shared/pricing.ts` | KEEP | Middleware-Enrichment |
| Shopware Sync | `apps/api/src/shopware/*` | KEEP | Dedizierter Client/Mapper/Queue |
| AI Pipeline | `apps/api/src/schema.ts aiData/manualData` | REFACTOR | Processor/Pipeline + Approval + Trace fehlt |
| Admin UI | `apps/web/src/*`, `shop-kern/public/admin.html` | REFACTOR | Zu Soll-Navi umbauen |
| Marketplace Adapter | `shop-kern/modules/marketplace/*` | KEEP | Externe Plattformen modular, Shopware primär |
| Storefront HTML | `shop-kern/public/index.html` | REMOVE | Kunden-Katalog verboten |
| Storefront JS | `shop-kern/public/shop.js` | REMOVE | Cart/Checkout verboten |
| Public Orders API | `shop-kern/server.js POST /api/orders`, `GET /api/products`, `GET /api/config` public | REMOVE | Kein interner Shop |
| OrderManager (intern) | `shop-kern/modules/orders.js` | REFACTOR | Zu Shopware-Mirror umwidmen |
| Payment | `paypalLink/stripe` in server.js/config | REMOVE | Kein Payment im Middleware |

## 4. Datenfluss Soll (zu implementieren)
```
1 Matterhorn Import (Adapter) → 2 Raw Storage → 3 Validation → 4 Normalization (mapper) → 5 AI Processing (Pipeline) → 6 AI Validation → 7 PENDING_REVIEW → 8 APPROVED → 9 READY_FOR_SYNC → 10 Sync Queue → 11 Shopware API → 12 SYNCED/FAILED+Retry → LOG
```
Jede Stufe: `originalValue/modifiedValue/processor/model/prompt/timestamp/approvalStatus` auditierbar.

## 5. Maßnahmen (Reihenfolge Directive)
1. Audit — dieses Dokument.
2. KEEP/REFACTOR/REMOVE — Tabelle oben.
3. Korrektur shop-kern: Storefront entfernen, Admin-only machen (nächster Commit).
4. Shopware als externen Connector festigen (shop-kern `mapper.mapWaWiToShopware` bleibt, `server.js` public routes entfernen).
5. Admin Control Center auf Soll-Navi bringen.
6. Datenintegrität: `products.json` via Backup vor Refactor, `orders.json` (Kunden-Orders) nicht als Source of Truth nutzen — Shopware ist Order-Source.

## 6. Akzeptanzkriterien (Auszug)
- [ ] Kein `shop-kern/public/index.html` Storefront mehr (oder redirect zu admin)
- [ ] Kein `cart/checkout/payment` in shop-kern
- [ ] `POST /api/orders` public entfernt
- [ ] Matterhorn Import → Canonical → AI → Approval → Shopware Sync nachweisbar
- [ ] Shopware Sync dediziert, retry-fähig
- [ ] Admin UI = Control Center, nicht Shop
- [ ] Architektur modular für weitere externe Plattformen
