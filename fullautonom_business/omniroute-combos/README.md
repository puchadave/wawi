# FO-Business OmniRoute Combos

**0€-Budget Dropship-System für Festival/DJ-Bekleidung**

## Architektur

```
┌─────────────────────────────────────────────────────────────┐
│              OMNIROUTE GATEWAY (CT 100)                     │
│  https://puchalla.online | http://192.168.176.22:20128     │
│  19 Strategies, Auto-Combo Engine, 90+ Free Tiers           │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ OpenAI-Compat API
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              MULTI-AGENT SYSTEM (Agenten)                   │
│  • Deer-Flow (BI-BRAIN) — Deep Research, Planning          │
│  • Ruflo+SYNINT (OSINT) — Echtzeit-Recherche              │
│  • owasp-social-osint (CRM) — Social Profiling             │
│  • MetaGPT (Orchestration) — Multi-Modul-DAG               │
└─────────────────────────────────────────────────────────────┘
```

## Combo-Struktur

Jede Combo enthält:
- `name` — Eindeutiger Combo-Name
- `strategy` — OmniRoute-Routing-Strategie (fallback, loadbalanced, etc.)
- `targets[]` — Ziel-Provider mit Modell, Endpoint, Kosten
- `budgetCap` — Monatliches Budget-Limit (0€ für Free-Tier)
- `modePack[]` — Modus-Variablen (z.B. `mode.creative`)
- `agentMiddleware` — System-Prompt für den Agenten
- `responseValidation` — Validierungs-Regex für die Antwort
- `model` — Gesamtmodell-Name (für Frontend-Anzeige)

## 32 Combos

| # | Combo | Modul | Aufgabe |
|---|-------|-------|---------|
| 01 | `bi-plan-deerflow` | BI-BRAIN | Deep Research, Businessplan |
| 02 | `bi-budget-deerflow` | BI-BRAIN | Budget-Verteilung |
| 03 | `bi-optimierung-deerflow` | BI-BRAIN | Prozess-Optimierung |
| 04 | `osint-trend-ruflo` | OSINT-ENGINE | Trend-Scanning |
| 05 | `osint-research-ruflo` | OSINT-ENGINE | Recherche |
| 06 | `osint-hashtag-ruflo` | OSINT-ENGINE | Hashtag-Forschung |
| 07 | `osint-competitor-ruflo` | OSINT-ENGINE | Wettbewerber-Analyse |
| 08 | `crm-profile-owasp` | CRM-INTEL | Social Profiling |
| 09 | `crm-lead-owasp` | CRM-INTEL | Lead-Scoring |
| 10 | `crm-humint-owasp` | CRM-INTEL | HUMINT-Daten |
| 11 | `crm-outreach-owasp` | CRM-INTEL | Outreach-Kampagnen |
| 12 | `marketing-content-metagpt` | MARKETING | Content-Generierung |
| 13 | `marketing-kampagne-metagpt` | MARKETING | Kampagnen-Planung |
| 14 | `marketing-posting-metagpt` | MARKETING | Posting-Strategie |
| 15 | `marketing-seo-metagpt` | MARKETING | SEO-Optimierung |
| 16 | `ecommerce-produkt-fastify` | ECOMMERCE | Produkt-Erstellung |
| 17 | `ecommerce-preis-fastify` | ECOMMERCE | Preis-Optimierung |
| 18 | `ecommerce-seo-fastify` | ECOMMERCE | Shop-SEO |
| 19 | `ecommerce-sync-fastify` | ECOMMERCE | Shopware-Sync |
| 20 | `fibu-forward-fastify` | FIBU | 10-Sek-Regel |
| 21 | `fibu-umsatzsteuer-fastify` | FIBU | USt-Berechnung |
| 22 | `fibu-bilanz-fastify` | FIBU | Bilanz-Report |
| 23 | `logistics-lieferant-fastify` | LOGISTIK | Lieferanten-Select |
| 24 | `logistics-versand-fastify` | LOGISTIK | Versand-Status |
| 25 | `logistics-retoure-fastify` | LOGISTIK | Retouren-Handling |
| 26 | `agent-deerflow` | AGENT | Deer-Flow Orchester |
| 27 | `agent-ruflo` | AGENT | Ruflo Swarm-Skills |
| 28 | `agent-metagpt` | AGENT | MetaGPT Multi-Agent |
| 29 | `agent-owasp` | AGENT | OWASP Social OSINT |
| 30 | `system-orchestrator-metagpt` | SYSTEM | Multi-Modul-DAG |
| 31 | `system-decision-fastify` | SYSTEM | Decision Engine |
| 32 | `system-monitor-fastify` | SYSTEM | System-Überwachung |

## Import via API

```bash
# Einzelne Combo importieren
curl -X POST http://192.168.176.22:20128/v1/combos \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d @combos/bi-plan-deerflow.json

# Alle Combos importieren
for f in combos/*.json; do
  curl -X POST http://192.168.176.22:20128/v1/combos \
    -H "Authorization: Bearer YOUR_API_KEY" \
    -H "Content-Type: application/json" \
    -d @$f
done
```

## Modell-Register

Siehe `_MODELL-REGISTER.md` für alle verfügbaren Modelle und Free-Tier-Limits.
