# Design: Marktplatz-Kanäle eBay, Kleinanzeigen, Kaufland, Otto

Datum: 2026-09-06
Status: approved (GO)
Scope: Phase 7 — vollständige A+B+C-Anbindung (Listing, Bestand, Bestellungen/Tracking, Kundenkommunikation) plus KI-gestützte Top-20-Auswahl.

## Ziel

Die WaWi bleibt der Master (Artikel, Bestand, Preise, Fulfillment). Externe Shopsoftware (Shopware 6) und Marktplätze (eBay, eBay Kleinanzeigen, Kaufland, Otto) sind Kanäle. Dieselbe Ware, die im eigenen Shop steht, wird dort angeboten. Verkäufe ziehen den WaWi-Bestand ab. Versand (DHL) und Tracking werden zurückgemeldet. Kundenkommunikation (Nachrichten) läuft über den Leitstand.

Launch-Kriterium: A+B+C komplett, nicht nur Textgeneratoren.

## Architektur

Ein Channel-Adapter-Interface in `shop-kern/modules/channels/`:

- `isConfigured()`
- `createOrUpdateListing(product)`
- `updateInventory(sku, stock)`
- `endListing(externalId)`
- `fetchOrders()`
- `fulfillOrder(externalOrderId, trackingNumber, carrier)`
- `fetchMessages()` / `sendMessage(threadId, text)`

Orchestrierung: `modules/channel-sync.js`

- WaWi-Bestand ist Master
- Listings-Mapping in `data/channel-listings.json`
- Importierte Marktplatz-Bestellungen in `orders.json` mit `source` / `channel` / `externalOrderId`
- Nach `setTracking()` Push an den Ursprungskanal
- Mock-Modus wenn Credentials fehlen (kein Crash, explizites `mode: mock|live`)

Kein extra Microservice. Hub-Middleware bleibt `wawi-middleware`.

## Kanäle

| Kanal | Live-API | Fallback |
|---|---|---|
| eBay | Sell Inventory + Fulfillment (OAuth2) | Mock + Listing-Payload |
| Kleinanzeigen | Optional REST wenn `KLEINANZEIGEN_API_URL` gesetzt | Professioneller Listing-Generator + CSV |
| Kaufland | Seller API (HMAC) | Mock + Payload |
| Otto | Otto Market OAuth2 | Mock + Payload |

## Top-20 (KI-gesteuert)

`modules/analytics.js` bewertet aktive Artikel nach Umsatz, Stückzahl, Marge, Bestand. Optional OpenAI nur für Begründungstext, Ranking bleibt deterministisch. Max. 20 Artikel oder Sets (Kategorie-Bündel).

## Sicherheit

Secrets nur in `config.json` / Env (`EBAY_*`, `KAUFLAND_*`, `OTTO_*`). Runtime-JSON bleibt gitignored. Keine Tokens in Logs.

## Tests

Unit-Tests gegen Mock-HTTP. Kein echter Marktplatz-Call in CI.

## Erfolg

1. Top-20 berechnen
2. Listings an alle konfigurierten Kanäle pushen
3. Bestellungen importieren, Bestand senken
4. DHL-Tracking zurückmelden
5. Leitstand zeigt Kanalstatus, Mock vs Live
