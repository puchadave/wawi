# OmniRoute Combos - WaWi Middleware Integration

Dieser Ordner enthält die **importierbaren JSON-Konfigurationen** für das externe OmniRoute AI Gateway (laufend in **CT 100**).

## Naming-Konvention

Alle Combos beginnen mit dem Präfix `wawi/` und verwenden **exakt die originalen OmniRoute-Feldbezeichnungen** (`strategy`, `targets`, `config`, `budgetCap`, `modePack` etc.).

## Liste aller Combos (14 Stück)

1. `wawi/produkt-relevanz-filter` - Whitelist-Match Prüfer (Modus A vs. C)
2. `wawi/produkt-normalisierung` - Pipeline für HTML-Cleaning & Attribut-Extraktion
3. `wawi/produktbild-analyse` - Visuelle Vorauswahl via `auto/vision`
4. `wawi/visuelle-aehnlichkeit` - Vector Embeddings + LLM Rerank
5. `wawi/seo-beschreibung` - Fusion-Jury für hochwertige DE-Produktbeschreibungen
6. `wawi/seo-metadaten` - Cost-optimized Meta-Title & Description
7. `wawi/attribute-und-kategorien` - Struct-Parsing für Shopware-Eigenschaften
8. `wawi/uebersetzung` - Multilinguale Übersetzungen (DE -> EN/FR/NL/IT/PL/CS)
9. `wawi/datenqualitaetspruefung` - Validierung vor Shopware-Sync
10. `wawi/set-designer` - Variable SET-Komposition ("Privater Modedesigner")
11. `wawi/set-bild-gen` - KI-Fotostudio (Modell- Lifestyle & Flatlay Fotos)
12. `wawi/trend-analyse` - OSINT/SOCMINT Trend-Scanner
13. `wawi/wettbewerber-analyse` - Preis- & Sortimentsanalyse der Konkurrenz
14. `wawi/operations-monitor` - Bestands- & Lieferzeit-Risiko-Monitor

## Import in OmniRoute (CT 100)

Die JSON-Dateien können direkt per cURL oder OmniRoute-Dashboard importiert werden:

```bash
curl -X POST http://192.168.176.100:20128/api/combos \
  -H "Authorization: Bearer <DEIN_OMNIROUTE_API_KEY>" \
  -H "Content-Type: application/json" \
  -d @omniroute-combos/wawi-set-designer.json
```
