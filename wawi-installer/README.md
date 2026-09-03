# WaWi PVE Helper-Script

Automatisches Deployment der WaWi Middleware (Matterhorn → Shopware 6) auf Proxmox VE LXC-Container.

## Schnellstart

```bash
# Auf dem Proxmox-Host ausführen:
bash -c "$(curl -fsSL https://raw.githubusercontent.com/puchadave/wawi/master/wawi-installer/wawi.sh)"
```

Oder nach dem Klonen:
```bash
bash wawi-installer/wawi.sh
```

## Flags (nicht-interaktiv)

```bash
bash wawi-installer/wawi.sh \
  --ctid 301 \
  --os debian \
  --mode docker \
  --secrets-dir /gdrive/wawi \
  --quiet
```

| Flag | Beschreibung | Default |
|------|-------------|---------|
| `--ctid <id>` | Container-ID | 301 |
| `--os <debian\|alpine>` | Basis-OS | debian |
| `--mode <docker\|nativ>` | Installationsmodus | docker |
| `--no-gui` | Kein whiptail, Defaults verwenden | aus |
| `--quiet` | Nur Ergebnis ausgeben | aus |
| `--secrets-dir <pfad>` | Pfad zum Importieren von Secrets | - |

## Interaktives Menü

Das Script führt durch:

1. **Host-Prüfung** — Proxmox VE, Root-Zugang, abhängige Tools
2. **Secrets-Import** — Bestehende `.env`/`.dev`-Dateien finden und importieren (eigener Suchpfad möglich)
3. **OS-Auswahl** — Debian 12 oder Alpine 3.20
4. **Modus-Auswahl** — Docker Compose (empfohlen) oder Nativ (Node.js)
5. **Container-Config** — CT-ID, RAM, CPU, Disk, Netzwerk
6. **API-Keys** — Shopware, Database, JWT, Matterhorn, OpenAI (vorbefüllt aus Import)
7. **LXC-Erstellung** — Template laden, Container erstellen
8. **Deployment** — Git klonen, bauen, starten
9. **Health-Check** — API erreichbar, Admin-Benutzer vorhanden
10. **GDrive-Backup** — Zugangsdaten sichern
11. **Zusammenfassung** — URLs, Ports, Login-Daten

## Voraussetzungen

- Proxmox VE 7/8 (Root-Zugang)
- `whiptail` (wird bei Bedarf installiert)
- Internetverbindung (für Template-Download, Docker-Installation, Git-Clone)

## Installation-Modi

### Docker Compose (empfohlen)
- Vollständig isoliert in Containern
- Automatischer Neustart bei Abstürzen
- Sauberes Upgrade über `docker compose pull && docker compose up -d`

### Nativ
- Node.js + nginx direkt im LXC
- Leichtgewichtiger
- Systemd-Service für API
