#!/usr/bin/env python3
"""
WaWi → Facebook Marketplace Import (Browser-Session, keine offizielle API — gibt es nicht.)

Wie es funktioniert:
1. Du loggst dich EINMAL in Facebook ein (Browserfenster öffnet sich).
2. Die Session wird gespeichert und wiederverwendet (data/fb_session/).
3. Das Script liest deine Produkte aus data/products.json.
4. Für jedes aktive Produkt wird das Marketplace-Erstellungsformular AUTOMATISCH
   ausgefüllt (Titel, Preis, Beschreibung, Kategorie).
5. Du prüfst und klickst "Veröffentlichen" — pro Listing ein Klick.
   (Kein Auto-Publish: mindert das Sperr-Risiko massiv, Facebook erkennt Bots.)

Hinweis: Facebook hat KEINE öffentliche API für Marketplace-Listings.
Rechtlich/ToS: Voll-Scraping & Automation verstößt gegen FB-Regeln und kann
Accounts sperren. Dieses Script ist als "Co-Pilot" gebaut: Es füllt die Arbeit,
der Mensch bestätigt — das ist der praktikable Mittelweg.

Installation (einmalig, auf deinem Rechner mit Python):
    pip install playwright
    playwright install chromium

Start:
    python3 social/fb_marketplace_uploader.py [--headless]

Wichtig: Kopf des Skripts anpassen — KATEGORIE_MAP enthält deine Kategorien.
Produktbilder: liegen unter public/images/<produkt-id>.jpg — sonst ohne Bild.
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent   # shop-kern/
DATA_DIR = ROOT / "data"
PRODUCTS_FILE = DATA_DIR / "products.json"
SESSION_DIR = DATA_DIR / "fb_session"
IMAGES_DIR = ROOT / "public" / "images"

# Facebook Marketplace: Kategorie pro Produkt-Kategorie (deutsch, anpassbar)
# Muss exakt den FB-Vorschlägen entsprechen oder nahe dran sein — FB matcht selbst.
KATEGORIE_MAP = {
    "Pullover": "Kleidung & Accessoires",
    "T-Shirts": "Kleidung & Accessoires",
    "Accessoires": "Kleidung & Accessoires",
    "Deko": "Sonstiges",
}

# Falls FB die Kategorie per Dropdown verlangt: Pfad-Fallback probieren
# (Facebook ändert DOM häufig — Selektoren sind konfigurierbar unten).

def load_products():
    if not PRODUCTS_FILE.exists():
        print(f"[FEHLER] {PRODUCTS_FILE} nicht gefunden. Shop-Kern zuerst starten.")
        sys.exit(1)
    data = json.loads(PRODUCTS_FILE.read_text(encoding="utf-8"))
    return [p for p in data.get("products", []) if p.get("active", False)]

def fill_by_label(page, label, value):
    """Findet Eingabefeld über Label-Text (diverse FB-DOM-Varianten)."""
    try:
        page.get_by_label(label, exact=False).fill(value)
        return True
    except Exception:
        pass
    # Fallback: input[aria-label*=...]
    try:
        page.locator(f'input[aria-label*="{label}"]').first.fill(value)
        return True
    except Exception:
        pass
    return False

def fill_by_placeholder(page, placeholder, value):
    try:
        page.get_by_placeholder(placeholder).fill(value)
        return True
    except Exception:
        return False

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--headless", action="store_true", help="Kopfzeilenlos (unsicherer, eher erkennbar)")
    ap.add_argument("--no-session", action="store_true", help="Session-Ordner bei Start leeren")
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright

    products = load_products()
    if not products:
        print("[FEHLER] Keine aktiven Produkte in products.json.")
        sys.exit(2)
    print(f"[i] {len(products)} aktive Produkte gefunden.")

    SESSION_DIR.mkdir(parents=True, exist_ok=True)
    if args.no_session:
        for f in SESSION_DIR.iterdir():
            if f.is_dir():
                import shutil; shutil.rmtree(f)
            else:
                f.unlink()
        print("[i] Session geleert — Login nötig.")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=args.headless, slow_mo=150)
        context = browser.new_context(
            user_data_dir=str(SESSION_DIR),
            locale="de-DE",
            viewport={"width": 1366, "height": 900},
        )
        page = context.new_page()

        # 1) Facebook öffnen — Login falls nötig
        print("[i] Öffne facebook.com ...")
        page.goto("https://www.facebook.com/", timeout=60000, wait_until="domcontentloaded")
        try:
            page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            pass

        # Login prüfen
        still_login = "login" in page.url.lower()
        if still_login or page.locator("form").count() > 3:
            print("[!] Bitte logge dich im Browserfenster in Facebook ein.")
            print("    Sobald du angemeldet bist (Startseite sichtbar), ENTER drücken ...")
            input("    > ") if not args.headless else None

        print("[i] Öffne Marketplace-Erstellung ...")
        page.goto("https://www.facebook.com/marketplace/create/item", timeout=60000, wait_until="domcontentloaded")
        time.sleep(4)

        # Prüfen ob wir auf dem Formular sind
        if "login" in page.url.lower():
            print("[FEHLER] Nicht eingeloggt. Ohne --headless starten und im Fenster einloggen.")
            browser.close()
            sys.exit(3)

        for idx, prod in enumerate(products):
            print(f"\n--- Produkt {idx+1}/{len(products)}: {prod['name']} ---")
            # Bei jedem Produkt direkt zur Erstellungsseite (frisches Formular)
            page.goto("https://www.facebook.com/marketplace/create/item", timeout=60000, wait_until="domcontentloaded")
            time.sleep(3)

            # Titel
            if not fill_by_placeholder(page, "Titel", prod["name"]) and not fill_by_label(page, "Title", prod["name"]):
                print("  [!] Titel-Feld nicht gefunden — bitte manuell ausfüllen.")

            # Preis / Betrag
            price = str(prod.get("price", 0)).replace(".", ",")
            price_field = page.locator('input[aria-label*="Preis"], input[aria-label*="Price"], input[placeholder*="Preis"], input[placeholder*="Betrag"]').first
            try:
                price_field.fill(price)
            except Exception:
                print("  [!] Preis-Feld nicht gefunden — manuell eintragen.")

            # Beschreibung
            desc = prod.get("description", "")
            if not fill_by_placeholder(page, "Beschreibung", desc) and not fill_by_placeholder(page, "Description", desc):
                # Textarea mit aria-label
                try:
                    page.locator('div[contenteditable="true"]').first.fill(desc)
                except Exception:
                    print("  [!] Beschreibung-Feld nicht gefunden — manuell.")

            # Kategorie
            cat = KATEGORIE_MAP.get(prod.get("category", ""), "Sonstiges")
            # Versuch: Radio/Dropdown-Kategorie wählen
            try:
                cat_el = page.get_by_text(cat, exact=False).first
                if cat_el.count() > 0:
                    cat_el.click()
                    time.sleep(1)
            except Exception:
                pass

            # Größe falls vorhanden
            if prod.get("sizes") and len(prod["sizes"]) == 1 and prod["sizes"][0] == "One Size":
                pass  # keine Größe nötig
            elif prod.get("sizes"):
                try:
                    sz = page.locator('select:has(option:has-text("Größe")), select[aria-label*="Größe"]').first
                    sz.select_option(label=prod["sizes"][0])
                except Exception:
                    pass

            # Bild falls vorhanden
            img = IMAGES_DIR / f"{prod['id']}.jpg"
            upload_btn = page.locator('input[type="file"]').first
            if img.exists():
                try:
                    upload_btn.set_input_files(str(img))
                    time.sleep(2)
                except Exception:
                    print("  [!] Bild-Upload fehlgeschlagen — ohne Bild weiter.")
            else:
                print(f"  [i] Kein Bild unter {img} — ohne Bild weiter.")

            print("\n  >>> Formular ausgefüllt. BITTE PRÜFEN und VERÖFFENTLICHEN klicken.")
            if not args.headless:
                input("  >>> ENTER drücken = nächstes Produkt (oder Formular anpassen) ...")

        print("\n[i] Fertig. Alle Produkte verarbeitet.")
        browser.close()

if __name__ == "__main__":
    main()