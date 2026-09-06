## Implementierungsplan: WaWi Multi-Marketplace & Kanal-Erweiterung (Produktion) - Phase 7

### 1. Ziel
Integration von eBay, eBay Kleinanzeigen, Kaufland und Otto als zusätzliche, vollautomatisierte Vertriebskanäle in die WaWi-Middleware. Dies umfasst Artikel-Listing, Lagerbestands- und Bestellsynchronisation sowie eine KI-gesteuerte Artikelauswahl (Top 20 Artikel/Artikel-Sets) und verbesserte Kundenkommunikation. Das System wird vollständig debugged und produktiv in Betrieb genommen.

### 2. Phasenübersicht
Das Projekt wird in inkrementelle Phasen unterteilt, um eine kontinuierliche Testbarkeit und Validierung zu gewährleisten.

#### Phase 1: Analytics-Engine & Grundstruktur der Adapter
- **Ziel:** Bereitstellung der KI-gesteuerten Top-20-Artikelauswahl und der grundlegenden API-Adapter-Schnittstellen für Marktplätze.

#### Phase 2: eBay-Anbindung (Listing & Inventory)
- **Ziel:** Implementierung der vollständigen eBay-API-Integration für Produktlistings und Lagerbestandssynchronisation.

#### Phase 3: eBay-Bestell-Sync & Kommunikation
- **Ziel:** Implementierung des automatischen Bestellimports von eBay und der Rückmeldung von Versandstatus/Trackingnummern. Erweiterung der Kundenkommunikation.

#### Phase 4: eBay Kleinanzeigen Listing-Generator (Verbesserung)
- **Ziel:** Optimierung und Automatisierung der Inseratserstellung für eBay Kleinanzeigen.

#### Phase 5: Kaufland & Otto Anbindung (Basis Listing & Inventory)
- **Ziel:** Implementierung der grundlegenden API-Integration für Produktlistings und Lagerbestandssynchronisation bei Kaufland und Otto.

#### Phase 6: Admin-UI Erweiterungen & Konsolidierung
- **Ziel:** Integration aller neuen Funktionen in den Admin-Leitstand für Konfiguration, Monitoring und manuelle Steuerung.

#### Phase 7: Finaler Test & Produktivstart
- **Ziel:** Umfassende End-to-End-Tests, Performance-Validierung und Go-Live des Systems.

### 3. Tasks pro Phase

#### Phase 1: Analytics-Engine & Grundstruktur der Adapter
- **Task 1.1:** Erstellung `modules/analytics.js`
  - **Beschreibung:** Implementierung einer `getTopProducts(count, criteria)`-Funktion, die basierend auf `orders.json` (Umsatz, Frequenz) und `pricing.js` (Marge) die Top-Produkte ermittelt.
  - **Priorität:** Hoch
  - **Verantwortlichkeit:** Hermes ONE
  - **DoD:** Modul `analytics.js` existiert und `getTopProducts` liefert korrekte Ergebnisse im Unit-Test.
- **Task 1.2:** Integration in `modules/channels.js`
  - **Beschreibung:** Anpassung der Exportfunktionen, um optional die Top-Produkte von `analytics.js` zu verwenden.
  - **Priorität:** Mittel
  - **Verantwortlichkeit:** Hermes ONE
  - **DoD:** `channels.js` kann Top-Produkte abrufen und nutzen.
- **Task 1.3:** Grundstruktur der Marktplatz-Adapter
  - **Beschreibung:** Erstellung von leeren Modulen `modules/ebay-adapter.js`, `modules/kaufland-adapter.js`, `modules/otto-adapter.js` mit Platzhaltern für Authentifizierung und grundlegende API-Aufrufe.
  - **Priorität:** Hoch
  - **Verantwortlichkeit:** Hermes ONE
  - **DoD:** Adapter-Module existieren und sind als Klassen strukturiert.
- **Task 1.4:** API-Endpoint für Top-Produkte
  - **Beschreibung:** Ergänzung von `shop-kern/server.js` um einen neuen `GET /api/admin/analytics/top-products` Endpoint, der die Top-Produkte liefert.
  - **Priorität:** Mittel
  - **Verantwortlichkeit:** Hermes ONE
  - **DoD:** Endpoint ist erreichbar und liefert Daten.
- **Task 1.5:** Erweiterung der Testsuite
  - **Beschreibung:** Ergänzung von `wawi_modules_test.js` um Unit-Tests für `analytics.js` und die grundlegenden Adapter-Strukturen.
  - **Priorität:** Hoch
  - **Verantwortlichkeit:** Hermes ONE
  - **DoD:** Tests laufen fehlerfrei durch.

#### Phase 2: eBay-Anbindung (Listing & Inventory)
- **Task 2.1:** eBay OAuth 2.0 Authentifizierung in `ebay-adapter.js`
  - **Beschreibung:** Implementierung des Client Credentials Flows, Speicherung und Refresh von Access Tokens. Externe Konfiguration in `config.json`.
  - **Priorität:** Hoch
  - **Verantwortlichkeit:** Hermes ONE
  - **DoD:** Authentifizierung ist funktionsfähig und Tokens werden verwaltet.
- **Task 2.2:** Produkt-Listing auf eBay
  - **Beschreibung:** Implementierung von `createEbayListing(product)` und `updateEbayListing(productId, product)` in `ebay-adapter.js` zur Erstellung und Aktualisierung von eBay-Listings. Mapping von WaWi-Produktdaten zu eBay-spezifischen Feldern (inkl. Varianten, Bilder, Kategorien, Preise).
  - **Priorität:** Hoch
  - **Verantwortlichkeit:** Hermes ONE
  - **DoD:** Produkte können erfolgreich auf eBay gelistet und aktualisiert werden (mit Mock-API im Test).
- **Task 2.3:** Lagerbestandssynchronisation zu eBay
  - **Beschreibung:** Implementierung von `updateEbayInventory(sku, stock)` in `ebay-adapter.js`. Integration mit der Redis `stock-updates` Queue (Worker). WaWi ist Master für den Bestand.
  - **Priorität:** Hoch
  - **Verantwortlichkeit:** Hermes ONE
  - **DoD:** Bestandsänderungen in WaWi werden asynchron zu eBay gespiegelt.
- **Task 2.4:** API-Endpoints für eBay-Management
  - **Beschreibung:** Ergänzung von `shop-kern/server.js` um `POST /api/admin/ebay/list-product` und `POST /api/admin/ebay/update-inventory` Endpoints.
  - **Priorität:** Mittel
  - **Verantwortlichkeit:** Hermes ONE
  - **DoD:** Endpoints sind erreichbar und lösen die Adapter-Funktionen aus.
- **Task 2.5:** Erweiterung der Testsuite
  - **Beschreibung:** Ergänzung von `wawi_modules_test.js` um Integrationstests für eBay-Listing und Inventory-Sync (mit Mock-APIs).
  - **Priorität:** Hoch
  - **Verantwortlichkeit:** Hermes ONE
  - **DoD:** Tests laufen fehlerfrei durch.

#### Phase 3: eBay-Bestell-Sync & Kommunikation
- **Task 3.1:** eBay Bestellimport
  - **Beschreibung:** Implementierung von `fetchEbayOrders()` in `ebay-adapter.js`, um neue Bestellungen von eBay abzurufen. Einplanung eines Cronjobs oder Polling-Mechanismus. Automatischer Import in `orders.js`.
  - **Priorität:** Hoch
  - **Verantwortlichkeit:** Hermes ONE
  - **DoD:** Neue eBay-Bestellungen erscheinen automatisch in der WaWi.
- **Task 3.2:** eBay Versandstatus-Rückmeldung
  - **Beschreibung:** Implementierung von `fulfillEbayOrder(orderId, trackingNumber, carrier)` in `ebay-adapter.js`. Integration mit der Redis `fulfillment` Queue (Worker), sobald eine WaWi-Bestellung als `VERSENDET` markiert wird.
  - **Priorität:** Hoch
  - **Verantwortlichkeit:** Hermes ONE
  - **DoD:** Versandstatus und Trackingnummer werden an eBay zurückgemeldet.
- **Task 3.3:** eBay Kundenkommunikation
  - **Beschreibung:** Implementierung von `fetchEbayMessages(orderId)` und `sendEbayMessage(orderId, message)` in `ebay-adapter.js` zur Integration in den Admin-Leitstand (optional: Weiterleitung an WhatsApp/Telegram).
  - **Priorität:** Mittel
  - **Verantwortlichkeit:** Hermes ONE
  - **DoD:** Nachrichten können über die WaWi empfangen und gesendet werden.
- **Task 3.4:** API-Endpoints für eBay-Bestellungen
  - **Beschreibung:** Ergänzung von `shop-kern/server.js` um Endpoints für den Bestellimport und Status-Update.
  - **Priorität:** Mittel
  - **Verantwortlichkeit:** Hermes ONE
  - **DoD:** Endpoints sind funktionsfähig.
- **Task 3.5:** Erweiterung der Testsuite
  - **Beschreibung:** Ergänzung von `wawi_modules_test.js` um Integrationstests für Bestellimport und Status-Rückmeldung (mit Mock-APIs).
  - **Priorität:** Hoch
  - **Verantwortlichkeit:** Hermes ONE
  - **DoD:** Tests laufen fehlerfrei durch.

#### Phase 4: eBay Kleinanzeigen Listing-Generator (Verbesserung)
- **Task 4.1:** Erweiterung `modules/channels.js` für Kleinanzeigen-Templates
  - **Beschreibung:** Verfeinerung der `generateKleinanzeigenListing` Funktion um weitere KI-optimierte Conversion-Trigger und dynamische Platzhalter.
  - **Priorität:** Mittel
  - **Verantwortlichkeit:** Hermes ONE
  - **DoD:** Generierte Kleinanzeigen-Texte sind qualitativ hochwertiger und flexibler.
- **Task 4.2:** Integration von `analytics.js` in Kleinanzeigen-Generator
  - **Beschreibung:** Der Kleinanzeigen-Generator nutzt die Top-20-Produkte, um bei der automatischen Generierung Prioritäten zu setzen oder spezielle Angebote zu erstellen.
  - **Priorität:** Niedrig
  - **Verantwortlichkeit:** Hermes ONE
  - **DoD:** Kleinanzeigen-Generator berücksichtigt Top-Produkte.
- **Task 4.3:** Erweiterung der Testsuite
  - **Beschreibung:** Ergänzung von `wawi_modules_test.js` um Tests für die verbesserten Kleinanzeigen-Templates.
  - **Priorität:** Mittel
  - **Verantwortlichkeit:** Hermes ONE
  - **DoD:** Tests laufen fehlerfrei durch.

#### Phase 5: Kaufland & Otto Anbindung (Basis Listing & Inventory)
- **Task 5.1:** Kaufland API-Anbindung in `kaufland-adapter.js`
  - **Beschreibung:** Implementierung von Authentifizierung und Basis-Funktionen für Produkt-Listing (`createKauflandListing`, `updateKauflandListing`) und Bestands-Updates (`updateKauflandInventory`).
  - **Priorität:** Hoch
  - **Verantwortlichkeit:** Hermes ONE
  - **DoD:** Produkte können gelistet und Bestände synchronisiert werden (mit Mock-API im Test).
- **Task 5.2:** Otto API-Anbindung in `otto-adapter.js`
  - **Beschreibung:** Implementierung von Authentifizierung und Basis-Funktionen für Produkt-Listing (`createOttoListing`, `updateOttoListing`) und Bestands-Updates (`updateOttoInventory`).
  - **Priorität:** Hoch
  - **Verantwortlichkeit:** Hermes ONE
  - **DoD:** Produkte können gelistet und Bestände synchronisiert werden (mit Mock-API im Test).
- **Task 5.3:** API-Endpoints für Kaufland & Otto
  - **Beschreibung:** Ergänzung von `shop-kern/server.js` um entsprechende Endpoints für Kaufland und Otto.
  - **Priorität:** Mittel
  - **Verantwortlichkeit:** Hermes ONE
  - **DoD:** Endpoints sind funktionsfähig.
- **Task 5.4:** Erweiterung der Testsuite
  - **Beschreibung:** Ergänzung von `wawi_modules_test.js` um Integrationstests für Kaufland und Otto (mit Mock-APIs).
  - **Priorität:** Hoch
  - **Verantwortlichkeit:** Hermes ONE
  - **DoD:** Tests laufen fehlerfrei durch.

#### Phase 6: Admin-UI Erweiterungen & Konsolidierung
- **Task 6.1:** Admin-Panel für eBay-Konfiguration
  - **Beschreibung:** Erweiterung von `admin.html` um Formularfelder für eBay API-Schlüssel, Shop-IDs, etc. mit Speicherung in `config.json`.
  - **Priorität:** Hoch
  - **Verantwortlichkeit:** Hermes ONE
  - **DoD:** eBay-Konfiguration kann über Admin-UI vorgenommen werden.
- **Task 6.2:** Admin-Panel für Kaufland & Otto Konfiguration
  - **Beschreibung:** Analog zu eBay, Konfigurationsfelder für Kaufland und Otto in `admin.html`.
  - **Priorität:** Mittel
  - **Verantwortlichkeit:** Hermes ONE
  - **DoD:** Kaufland- und Otto-Konfiguration kann über Admin-UI vorgenommen werden.
- **Task 6.3:** Admin-Panel für Listing- & Order-Monitoring
  - **Beschreibung:** Neue Tabs/Sektionen in `admin.html` zur Anzeige von aktiven eBay/Kaufland/Otto-Listings, Bestands-Sync-Status und importierten Bestellungen von den Marktplätzen.
  - **Priorität:** Hoch
  - **Verantwortlichkeit:** Hermes ONE
  - **DoD:** Admin-UI zeigt relevante Marktplatz-Daten an.
- **Task 6.4:** Manuelle Aktionen im Admin-Panel
  - **Beschreibung:** Buttons in `admin.html` zum manuellen Starten von Listing-Erstellung, Bestands-Sync, Bestellimport für einzelne Produkte/Marktplätze.
  - **Priorität:** Mittel
  - **Verantwortlichkeit:** Hermes ONE
  - **DoD:** Manuelle Aktionen können über Admin-UI ausgelöst werden.

#### Phase 7: Finaler Test & Produktivstart
- **Task 7.1:** Umfassende End-to-End-Integrationstests
  - **Beschreibung:** Durchführung einer vollständigen Testrunde, die alle integrierten Module und Kanäle (Shopware, eBay, Kleinanzeigen, Kaufland, Otto, WhatsApp, Telegram, Google Shopping Feed) abdeckt.
  - **Priorität:** Hoch
  - **Verantwortlichkeit:** Hermes ONE
  - **DoD:** Alle automatisierten Tests bestanden, keine kritischen Fehler in manuellen Tests gefunden.
- **Task 7.2:** Performance-Validierung
  - **Beschreibung:** Überprüfung der Systemleistung unter Last (simulierter XML-Import, Bestellspitzen, Bestands-Updates) mittels integriertem Logger und Telemetrie.
  - **Priorität:** Hoch
  - **Verantwortlichkeit:** Hermes ONE
  - **DoD:** System ist performant und stabil unter Last.
- **Task 7.3:** Dokumentation für Produktivstart
  - **Beschreibung:** Aktualisierung der `README.md` und des `deploy-cluster.sh` Skripts mit Anweisungen zur Konfiguration und zum Start der neuen Marktplatz-Integrationen.
  - **Priorität:** Hoch
  - **Verantwortlichkeit:** Hermes ONE
  - **DoD:** Dokumentation ist vollständig und verständlich.
- **Task 7.4:** Produktivstart
  - **Beschreibung:** Deployment des vollständigen Systems auf dem Docker Swarm Cluster.
  - **Priorität:** Hoch
  - **Verantwortlichkeit:** Hermes ONE
  - **DoD:** System läuft stabil und alle Kanäle sind aktiv.

### 4. Risiken & Mitigation
- **Risiko:** API-Limits/Rate Limiting der Marktplätze.
  - **Mitigation:** Asynchrone Queues (Redis/BullMQ) mit Backoff-Strategien, intelligente Batch-Verarbeitung.
- **Risiko:** Dateninkonsistenzen zwischen WaWi und Marktplätzen.
  - **Mitigation:** WaWi als Master-Datenquelle, Differential Hashing, regelmäßige Re-Sync-Mechanismen, Audit-Logs bei jeder Änderung.
- **Risiko:** Komplexität der eBay/Kaufland/Otto APIs.
  - **Mitigation:** Kapselung in dedizierten Adapter-Modulen, inkrementelle Implementierung, intensive Unit- und Integrationstests mit Mock-APIs.
- **Risiko:** Unzureichende Fehlerbehandlung für API-Antworten.
  - **Mitigation:** Umfassendes Logging aller API-Aufrufe und Antworten, robustes Error-Handling in den Adaptern, Anzeige von Fehlern im Admin-Leitstand.

### 5. Validierung
Jede Phase wird mit spezifischen Unit- und Integrationstests validiert, die in `wawi_modules_test.js` integriert werden. Die kontinuierliche Debugging- und Telemetrie-Engine (`modules/logger.js`) wird während der gesamten Entwicklung und im Produktivbetrieb genutzt, um die korrekte Ausführung und Performance zu überwachen.

---

**Bestätigung:**

Dieser Implementierungsplan ist fertig und zum Start bereit.
