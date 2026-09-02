// ============================================================================
// Module Registry — Zentrale Service-Discovery & Health-Tracking
// ============================================================================

import { ModuleConfig, ModuleHealth, ModuleId, ModuleMetrics, ServiceEndpoint } from './types/index.js';

export const MODULE_REGISTRY: Record<ModuleId, ModuleConfig> = {
  'api-gateway': {
    id: 'api-gateway',
    port: 8080,
    host: '0.0.0.0',
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    databaseUrl: process.env.DATABASE_URL || 'postgresql://fullautonom:fullautonom_secure_2026@localhost:5432/fullautonom',
  },
  'crm-intel': {
    id: 'crm-intel',
    port: 3001,
    host: '0.0.0.0',
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    databaseUrl: process.env.DATABASE_URL || 'postgresql://fullautonom:fullautonom_secure_2026@localhost:5432/fullautonom',
  },
  'marketing-autopilot': {
    id: 'marketing-autopilot',
    port: 3002,
    host: '0.0.0.0',
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    databaseUrl: process.env.DATABASE_URL || 'postgresql://fullautonom:fullautonom_secure_2026@localhost:5432/fullautonom',
    aiGatewayUrl: process.env.OMNIROUTE_LOCAL_URL || 'http://192.168.176.22:20128',
  },
  'ecommerce-core': {
    id: 'ecommerce-core',
    port: 3003,
    host: '0.0.0.0',
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    databaseUrl: process.env.DATABASE_URL || 'postgresql://fullautonom:fullautonom_secure_2026@localhost:5432/fullautonom',
  },
  'fibu-autonomous': {
    id: 'fibu-autonomous',
    port: 3004,
    host: '0.0.0.0',
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    databaseUrl: process.env.DATABASE_URL || 'postgresql://fullautonom:fullautonom_secure_2026@localhost:5432/fullautonom',
  },
  'logistics-hub': {
    id: 'logistics-hub',
    port: 3005,
    host: '0.0.0.0',
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    databaseUrl: process.env.DATABASE_URL || 'postgresql://fullautonom:fullautonom_secure_2026@localhost:5432/fullautonom',
  },
  'bi-brain': {
    id: 'bi-brain',
    port: 3006,
    host: '0.0.0.0',
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    databaseUrl: process.env.DATABASE_URL || 'postgresql://fullautonom:fullautonom_secure_2026@localhost:5432/fullautonom',
    aiGatewayUrl: process.env.OMNIROUTE_LOCAL_URL || 'http://192.168.176.22:20128',
  },
  'osint-engine': {
    id: 'osint-engine',
    port: 3007,
    host: '0.0.0.0',
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    databaseUrl: process.env.DATABASE_URL || 'postgresql://fullautonom:fullautonom_secure_2026@localhost:5432/fullautonom',
    aiGatewayUrl: process.env.OMNIROUTE_LOCAL_URL || 'http://192.168.176.22:20128',
  },
  'omniroute-ai': {
    id: 'omniroute-ai',
    port: 20128,
    host: '0.0.0.0',
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    databaseUrl: process.env.DATABASE_URL || 'postgresql://fullautonom:fullautonom_secure_2026@localhost:5432/fullautonom',
  },
  'data-lake': {
    id: 'data-lake',
    port: 3008,
    host: '0.0.0.0',
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    databaseUrl: process.env.DATABASE_URL || 'postgresql://fullautonom:fullautonom_secure_2026@localhost:5432/fullautonom',
  },
  'client-console': {
    id: 'client-console',
    port: 5173,
    host: '0.0.0.0',
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    databaseUrl: process.env.DATABASE_URL || 'postgresql://fullautonom:fullautonom_secure_2026@localhost:5432/fullautonom',
  },
};

export const SERVICE_ENDPOINTS: Record<ModuleId, ServiceEndpoint[]> = {
  'api-gateway': [
    { moduleId: 'api-gateway', path: '/health', method: 'GET', description: 'Gateway Health Check' },
    { moduleId: 'api-gateway', path: '/modules', method: 'GET', description: 'Alle registrierten Module' },
    { moduleId: 'api-gateway', path: '/modules/:id/health', method: 'GET', description: 'Modul-Health abfragen' },
    { moduleId: 'api-gateway', path: '/report-health', method: 'POST', description: 'Health von Modul empfangen' },
    { moduleId: 'api-gateway', path: '/report-metric', method: 'POST', description: 'Metriken von Modul empfangen' },
    { moduleId: 'api-gateway', path: '/rate-limit-check', method: 'GET', description: 'Rate-Limit prüfen' },
  ],
  'crm-intel': [
    { moduleId: 'crm-intel', path: '/customers', method: 'GET', description: 'Kunden auflisten' },
    { moduleId: 'crm-intel', path: '/customers', method: 'POST', description: 'Kundenprofil erstellen' },
    { moduleId: 'crm-intel', path: '/customers/:id/profile', method: 'GET', description: 'Profil abfragen' },
    { moduleId: 'crm-intel', path: '/customers/:id/social', method: 'POST', description: 'Social-Media-Profil hinzufügen' },
    { moduleId: 'crm-intel', path: '/customers/:id/humint', method: 'PUT', description: 'HUMINT-Profil aktualisieren' },
    { moduleId: 'crm-intel', path: '/leads', method: 'GET', description: 'Leads auflisten' },
    { moduleId: 'crm-intel', path: '/leads/generate', method: 'POST', description: 'Leads generieren' },
  ],
  'marketing-autopilot': [
    { moduleId: 'marketing-autopilot', path: '/campaigns', method: 'GET', description: 'Kampagnen auflisten' },
    { moduleId: 'marketing-autopilot', path: '/campaigns', method: 'POST', description: 'Kampagne erstellen' },
    { moduleId: 'marketing-autopilot', path: '/content/generate', method: 'POST', description: 'Content generieren' },
    { moduleId: 'marketing-autopilot', path: '/content/schedule', method: 'POST', description: 'Content planen' },
    { moduleId: 'marketing-autopilot', path: '/social/post', method: 'POST', description: 'Social-Media-Post veröffentlichen' },
    { moduleId: 'marketing-autopilot', path: '/optimal-times', method: 'GET', description: 'Optimale Posting-Zeiten' },
  ],
  'ecommerce-core': [
    { moduleId: 'ecommerce-core', path: '/products', method: 'GET', description: 'Produkte auflisten' },
    { moduleId: 'ecommerce-core', path: '/products', method: 'POST', description: 'Produkt erstellen' },
    { moduleId: 'ecommerce-core', path: '/products/:id/sync', method: 'POST', description: 'Shopware-Sync triggern' },
    { moduleId: 'ecommerce-core', path: '/orders', method: 'GET', description: 'Bestellungen auflisten' },
    { moduleId: 'ecommerce-core', path: '/orders/:id/process', method: 'POST', description: 'Bestellung verarbeiten' },
  ],
  'fibu-autonomous': [
    { moduleId: 'fibu-autonomous', path: '/transactions', method: 'GET', description: 'Transaktionen auflisten' },
    { moduleId: 'fibu-autonomous', path: '/transactions', method: 'POST', description: 'Transaktion buchen' },
    { moduleId: 'fibu-autonomous', path: '/balance', method: 'GET', description: 'Kontostand abfragen' },
    { moduleId: 'fibu-autonomous', path: '/tax/calculate', method: 'POST', description: 'Steuern berechnen' },
    { moduleId: 'fibu-autonomous', path: '/tax/submit', method: 'POST', description: 'Steuererklärung einreichen' },
    { moduleId: 'fibu-autonomous', path: '/enforce-rule', method: 'POST', description: '10-Sek-Regel erzwingen' },
    { moduleId: 'fibu-autonomous', path: '/financial-health', method: 'GET', description: 'Finanzielle Gesundheit' },
    { moduleId: 'fibu-autonomous', path: '/target-progress', method: 'GET', description: 'Ziel-Fortschritt (500€/14T, 1000€/30T)' },
  ],
  'logistics-hub': [
    { moduleId: 'logistics-hub', path: '/suppliers', method: 'GET', description: 'Lieferanten auflisten' },
    { moduleId: 'logistics-hub', path: '/suppliers', method: 'POST', description: 'Lieferanten registrieren' },
    { moduleId: 'logistics-hub', path: '/orders', method: 'POST', description: 'Bestellung an Lieferant' },
    { moduleId: 'logistics-hub', path: '/orders/:id/track', method: 'GET', description: 'Sendung verfolgen' },
    { moduleId: 'logistics-hub', path: '/returns', method: 'POST', description: 'Retoure anmelden' },
  ],
  'bi-brain': [
    { moduleId: 'bi-brain', path: '/reports', method: 'GET', description: 'BI-Reports auflisten' },
    { moduleId: 'bi-brain', path: '/reports/generate', method: 'POST', description: 'Report generieren' },
    { moduleId: 'bi-brain', path: '/recommendations', method: 'GET', description: 'Optimierungsvorschläge' },
    { moduleId: 'bi-brain', path: '/budget', method: 'GET', description: 'Budget-Übersicht' },
    { moduleId: 'bi-brain', path: '/budget/adjust', method: 'POST', description: 'Budget anpassen' },
    { moduleId: 'bi-brain', path: '/business-plan', method: 'GET', description: 'Optimierten Businessplan' },
    { moduleId: 'bi-brain', path: '/metrics', method: 'POST', description: 'Modul-Metriken empfangen' },
  ],
  'osint-engine': [
    { moduleId: 'osint-engine', path: '/targets', method: 'GET', description: 'Recherche-Ziele auflisten' },
    { moduleId: 'osint-engine', path: '/targets', method: 'POST', description: 'Recherche-Ziel hinzufügen' },
    { moduleId: 'osint-engine', path: '/scan', method: 'POST', description: 'Scan starten' },
    { moduleId: 'osint-engine', path: '/scan-all', method: 'POST', description: 'Alle Targets scannen' },
    { moduleId: 'osint-engine', path: '/trends', method: 'GET', description: 'Trends abfragen' },
    { moduleId: 'osint-engine', path: '/competitors', method: 'GET', description: 'Wettbewerberdaten' },
    { moduleId: 'osint-engine', path: '/competitors/analyze', method: 'POST', description: 'Wettbewerber analysieren' },
  ],
  'omniroute-ai': [
    { moduleId: 'omniroute-ai', path: '/api/combos', method: 'GET', description: 'Alle Combos auflisten' },
    { moduleId: 'omniroute-ai', path: '/api/combos/:id/run', method: 'POST', description: 'Combo ausführen' },
    { moduleId: 'omniroute-ai', path: '/api/combos', method: 'POST', description: 'Combo importieren' },
  ],
  'data-lake': [],
  'client-console': [],
};

export function getModuleConfig(moduleId: ModuleId): ModuleConfig | undefined {
  return MODULE_REGISTRY[moduleId];
}

export function getModuleEndpoints(moduleId: ModuleId): ServiceEndpoint[] {
  return SERVICE_ENDPOINTS[moduleId] || [];
}

export function getAllModuleHealth(): ModuleHealth[] {
  return Object.values(MODULE_REGISTRY).map(config => ({
    moduleId: config.id,
    status: 'healthy',
    uptime: process.uptime(),
    lastCheck: new Date(),
    metrics: {
      requestsTotal: 0,
      requestsPerMinute: 0,
      avgResponseTimeMs: 0,
      errorRate: 0,
      memoryUsageMb: 0,
      cpuUsagePercent: 0,
    },
  }));
}