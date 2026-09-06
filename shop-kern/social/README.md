# WaWi → Facebook Marketplace Import (Browser-Session)

Facebook hat **keine öffentliche API** für Marketplace-Listings. Dieses Script
importiert deine WaWi-Produkte deshalb über eine **echte Chromium-Browsersession**
(Playwright) — du loggst dich einmalig ein, die Session bleibt gespeichert, und
jedes Produkt wird automatisch ins Marketplace-Formular übernommen. Du
bestätigst am Ende mit einem Klick (Co-Pilot-Prinzip).

> Wichtig: Kein Auto-Publish. Voll-Scraping/Automation verstößt gegen FB-ToS und
> riskiert Account-Sperren. Dieses Script erledigt die Arbeit, der Mensch bleibt
> am Steuer. Das minimiert das Sperr-Risiko und erfüllt den Zweck.

## Installation (einmalig)

```bash
# Python + Playwright
pip install playwright
playwright install chromium
```

## Nutzung

```bash
# Im shop-kern/-Ordner (Produkte liegen unter data/products.json)
python3 social/fb_marketplace_uploader.py
```

- Beim ersten Start öffnet sich ein Browserfenster → in Facebook einloggen.
- Danach läuft es über die gespeicherte Session (`data/fb_session/`) weiter.
- Jedes Produkt wird ins Formular übernommen → du klickst "Veröffentlichen".
- ENTER = nächtes Produkt.

## Produktbilder

Lege unter `public/images/<produkt-id>.jpg` ein Bild pro Produkt ab. Das Script
lädt es automatisch in den Upload. Beispiel: `uptempo-hardcore-crewneck.jpg`.

## Kategorien anpassen

Die Zuordnung Shop-Kategorie → FB-Kategorie liegt oben im Script
(`KATEGORIE_MAP`). Anpassen, falls Facebook anders matcht.

## Wichtige Grenzen (ehrlich)

- Facebook ändert das DOM häufig. Falls ein Feld nicht gefunden wird, füllt das
  Script es nicht aus und meldet `[!]` — dann manuell ergänzen.
- Das Script arbeitet **nicht** vollautomatisch gegen die ToS. Wenn du es auf
  eigene Verantwortung vollautomatisieren willst (Auto-Publish), ist das deine
  Entscheidung — Fiasko-Risiko inklusive.
- Falls der Account trotzdem eingeschränkt wird: Widerspruch über
  facebook.com/help einreichen.