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
| `--os <debian\|alpine\|debian-minimal>` | Basis-OS | alpine |
| `--debian-variant <standard\|minimal>` | Debian-Variante | standard |
| `--mode <docker\|nativ>` | Installationsmodus | docker |
| `--no-gui` | Kein whiptail, Defaults verwenden | aus |
| `--quiet` | Nur Ergebnis ausgeben | aus |
| `--secrets-dir <pfad>` | Pfad zum Importieren von Secrets | - |
| `--dry-run` | Nur Menüs, kein Deployment | aus |

## Interaktives Menü

Das Script führt durch:

1. **Host-Prüfung** — Proxmox VE, Root-Zugang, abhängige Tools (git/curl/ca-certificates/bash validiert)
2. **Secrets-Import** — Bestehende `.env`/`.dev`-Dateien finden und importieren (eigener Suchpfad möglich)
3. **OS-Auswahl** — Alpine 3.20, Debian 12 Standard oder Debian 12 Minimal
4. **Modus-Auswahl** — Docker Compose (empfohlen) oder Nativ (Node.js)
5. **Container-Config** — CT-ID, RAM, CPU, Disk, Netzwerk
6. **API-Keys** — Shopware, Database, JWT, Matterhorn, OpenAI (vorbefüllt aus Import)
7. **LXC-Erstellung** — Template laden, Container erstellen
8. **Deployment** — Robuste Installation: Dependency-Prüfung → git clone → docker compose / npm build
9. **Health-Check** — API erreichbar, Admin-Benutzer vorhanden
10. **GDrive-Backup** — Zugangsdaten sichern
11. **Zusammenfassung** — URLs, Ports, Login-Daten

## Voraussetzungen

- Proxmox VE 7/8 (Root-Zugang)
- `whiptail` (wird bei Bedarf installiert)
- Internetverbindung (für Template-Download, Docker-Installation, Git-Clone)

## Installationsarchitektur (NEU)

Seit dem Fix gibt es drei robuste, unabhängige Installationspfade:

| Pfad | Datei | OS-Pakete | Docker |
|------|-------|-----------|--------|
| **Debian Standard** | `install-debian.sh` | `apt-get update` + `apt-get install -y git curl ca-certificates bash gnupg` | offizielles Docker-Repo (`docker-ce`, `docker-compose-plugin`) |
| **Debian Minimal** | `install-debian-minimal.sh` | `apt-get update` + `apt-get install -y --no-install-recommends git curl ca-certificates bash` | distro-Pakete (`docker.io`, `docker-compose`) |
| **Alpine** | `install-alpine.sh` | `apk update` + `apk add --no-cache git curl ca-certificates bash` | `apk add docker docker-compose` |

Gemeinsame Logik liegt zentral in `lib/common.sh`.

Direktaufruf je Pfad (im Zielsystem oder via `pct exec`):

```bash
# Debian Standard (vollständig)
bash wawi-installer/install-debian.sh

# Debian Minimal (schlank, --no-install-recommends)
bash wawi-installer/install-debian-minimal.sh

# Alpine
bash wawi-installer/install-alpine.sh

# Modus umschalten: DEPLOY_MODE=nativ / docker (Default: docker)
DEPLOY_MODE=nativ bash wawi-installer/install-alpine.sh
```

Der Hauptinstaller `wawi.sh` delegiert automatisch an den passenden Pfad (`DEBIAN_VARIANT=standard|minimal`):

```bash
bash wawi-installer/wawi.sh --os debian-minimal --mode docker --no-gui
bash wawi-installer/wawi.sh --os alpine --mode nativ --no-gui
bash wawi-installer/wawi.sh --os debian --debian-variant minimal --mode docker
```

### Dependency-Handling (robust)

Jedes Skript führt vor der eigentlichen Installation eine vollständige Dependency-Prüfung durch:

```bash
require_command git || install_git
require_command git || fatal "Git installation failed"
git clone ...
```

```bash
require_command docker || install_docker
require_command docker || fatal "Docker installation failed"
docker compose up -d --build
```

Nach der Installation wird jede Dependency aktiv geprüft:

```bash
command -v git
command -v docker
docker --version
docker compose version
```

Wenn eine Dependency fehlt: klare Fehlermeldung → Installationsversuch → erneute Prüfung → Abbruch mit eindeutigem Fehler.
Das Repository wird erst geklont, nachdem `git` erfolgreich geprüft wurde; `docker` wird erst verwendet, nachdem `docker` verfügbar ist.

### Validierung

Am Ende ruft jeder Installer (und `wawi.sh` im Container nach dem Deployment) die Validierungsroutine auf:

```bash
validate_environment [debian|debian-minimal|alpine] [docker|nativ]
```

Diese prüft `git`, `curl`, `ca-certificates`, `bash` sowie `docker`/`docker compose` (oder `node` im Nativ-Modus).

## Installation-Modi

### Docker Compose (empfohlen)
- Vollständig isoliert in Containern
- Postgres, Redis, API, Web via `docker-compose.yml`
- Healthchecks für alle Services

### Nativ
- Node.js direkt im LXC (schneller, weniger Overhead)
- `systemd` (Debian) oder `openrc` (Alpine) für API
- `nginx` für Web

## Smoke-Tests

```bash
bash wawi-installer/smoke-tests/smoke-common.sh          # alle Pfade + Host-Validierung
bash wawi-installer/smoke-tests/smoke-debian.sh          # Debian Standard
bash wawi-installer/smoke-tests/smoke-debian-minimal.sh  # Debian Minimal
bash wawi-installer/smoke-tests/smoke-alpine.sh          # Alpine (inkl. Live-Alpine Container Test bei Docker)
```

Alle Tests prüfen Syntax (`bash -n`), OS-Trennung, `command -v`/`--version` Checks und `validate_environment`.

## Architektur: `lib/common.sh`

Zentrale Bibliothek mit:

- `detect_os`, `require_command`, `require_command_or_install`, `ensure_command`
- Debian: `apt_update`, `apt_install_debian`, `apt_install_debian_minimal`, `install_docker_debian_standard`, `install_docker_debian_minimal`
- Alpine: `apk_update`, `apk_add`, `install_docker_alpine`
- Validierung: `validate_git`, `validate_curl`, `validate_bash`, `validate_ca_certificates`, `validate_docker`, `validate_environment`
- Sicherer Einsatz: `safe_git_clone`, `ensure_docker_available`

OS-spezifische Paketinstallation ist sauber getrennt (siehe Regeln oben).

## Fix: vorheriger Fehler

Vorher installierte der Container `docker` und versuchte sofort `git clone` — der Container enthielt jedoch kein `git` (`sh: git: not found`). Dies ist behoben: jedes Skript prüft und installiert `git` (und alle Basis-Dependencies) vor dem ersten `git clone`.

## Umgebungsvariablen

| Variable | Beschreibung | Default |
|----------|-------------|---------|
| `REPO_URL` | Git-Repo | `https://github.com/puchadave/wawi.git` |
| `INSTALL_DIR` | Installationsverzeichnis | `/opt/wawi` |
| `DEPLOY_MODE` | `docker` oder `nativ` | `docker` |
| `WEB_PORT` | Web-Port | `5173` |
| `API_PORT` | API-Port | `3000` |

## Manuelle Schritte nach der Installation

```bash
# Logs
pct exec <CTID> -- docker compose -f /opt/wawi/docker-compose.yml logs -f
pct exec <CTID> -- cat /var/log/wawi-api.log   # nativ

# Neustart
pct exec <CTID> -- bash -c "cd /opt/wawi && docker compose restart"
```

## Lizenz

Internes Projekt — nur für autorisierte Installationen.
