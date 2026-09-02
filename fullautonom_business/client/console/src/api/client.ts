import type {
  ModuleHealth,
  CustomerProfile,
  MarketingCampaign,
  BalanceState,
  Supplier,
  BiReport,
  BiRecommendation,
  TrendData,
  NicheProduct,
} from '@fullautonom/shared';

// ============================================================================
// FO-Business Console - API Client
// Verbindet sich per REST mit allen Server-Modulen (Workstation/LXC)
// ============================================================================

const SERVER_HOST = import.meta.env.VITE_SERVER_HOST ?? '127.0.0.1';
const ports: Record<string, string> = {
  gateway: import.meta.env.VITE_API_GATEWAY_PORT ?? '8080',
  crm: import.meta.env.VITE_CRM_INTEL_PORT ?? '3001',
  marketing: import.meta.env.VITE_MARKETING_PORT ?? '3002',
  ecommerce: import.meta.env.VITE_ECOMMERCE_PORT ?? '3003',
  fibu: import.meta.env.VITE_FIBU_PORT ?? '3004',
  logistics: import.meta.env.VITE_LOGISTICS_PORT ?? '3005',
  bi: import.meta.env.VITE_BI_PORT ?? '3006',
  osint: import.meta.env.VITE_OSINT_PORT ?? '3007',
};

export function endpoint(module: keyof typeof ports, path: string): string {
  return `http://${SERVER_HOST}:${ports[module]}${path}`;
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });
  if (!res.ok) throw new Error(`API-Fehler ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// ============================================================================
// API-Gateway / Health
// ============================================================================

export const gatewayApi = {
  health: () => fetchJson<{ status: string; registeredModules: number }>(endpoint('gateway', '/health')),
  modules: () => fetchJson<{ modules: unknown; health: ModuleHealth[] }>(endpoint('gateway', '/modules')),
  moduleHealth: (id: string) => fetchJson<ModuleHealth>(endpoint('gateway', `/modules/${id}/health`)),
};

// ============================================================================
// CRM-Intel
// ============================================================================

export const crmApi = {
  customers: () => fetchJson<CustomerProfile[]>(endpoint('crm', '/customers')),
  leads: (filter?: string) => fetchJson<CustomerProfile[]>(endpoint('crm', `/leads${filter ? `?${filter}` : ''}`)),
  createCustomer: (data: Record<string, unknown>) =>
    fetchJson<CustomerProfile>(endpoint('crm', '/customers'), { method: 'POST', body: JSON.stringify(data) }),
  addSocial: (id: string, data: Record<string, unknown>) =>
    fetchJson(endpoint('crm', `/customers/${id}/social`), { method: 'POST', body: JSON.stringify(data) }),
  generateLead: (data: Record<string, unknown>) =>
    fetchJson<CustomerProfile>(endpoint('crm', '/leads/generate'), { method: 'POST', body: JSON.stringify(data) }),
};

// ============================================================================
// Marketing-Autopilot
// ============================================================================

export const marketingApi = {
  campaigns: () => fetchJson<MarketingCampaign[]>(endpoint('marketing', '/campaigns')),
  generateContent: (data: Record<string, unknown>) =>
    fetchJson(endpoint('marketing', '/content/generate'), { method: 'POST', body: JSON.stringify(data) }),
  optimalTimes: () => fetchJson<{ times: string[] }>(endpoint('marketing', '/optimal-times')),
  createCampaign: (data: Record<string, unknown>) =>
    fetchJson(endpoint('marketing', '/campaigns'), { method: 'POST', body: JSON.stringify(data) }),
};

// ============================================================================
// Ecommerce-Core
// ============================================================================

export const ecommerceApi = {
  products: () => fetchJson<NicheProduct[]>(endpoint('ecommerce', '/products')),
  createProduct: (data: Record<string, unknown>) =>
    fetchJson(endpoint('ecommerce', '/products'), { method: 'POST', body: JSON.stringify(data) }),
  orders: () => fetchJson<Array<Record<string, unknown>>>(endpoint('ecommerce', '/orders')),
};

// ============================================================================
// FiBu-Autonomous
// ============================================================================

export const fibuApi = {
  balance: () => fetchJson<BalanceState>(endpoint('fibu', '/balance')),
  transaction: (data: Record<string, unknown>) =>
    fetchJson(endpoint('fibu', '/transactions'), { method: 'POST', body: JSON.stringify(data) }),
  enforceRule: () => fetchJson<{ success: boolean; balance: BalanceState }>(endpoint('fibu', '/enforce-rule'), { method: 'POST' }),
  tax: () => fetchJson(endpoint('fibu', '/tax/calculate'), { method: 'POST' }),
  health: () => fetchJson(endpoint('fibu', '/financial-health')),
  targetProgress: () => fetchJson(endpoint('fibu', '/target-progress')),
};

// ============================================================================
// Logistics-Hub
// ============================================================================

export const logisticsApi = {
  suppliers: () => fetchJson<Supplier[]>(endpoint('logistics', '/suppliers')),
  createOrder: (data: Record<string, unknown>) =>
    fetchJson(endpoint('logistics', '/orders'), { method: 'POST', body: JSON.stringify(data) }),
  trackOrder: (id: string) => fetchJson(endpoint('logistics', `/orders/${id}/track`)),
};

// ============================================================================
// BI-Brain
// ============================================================================

export const biApi = {
  businessPlan: () => fetchJson<Record<string, string>>(endpoint('bi', '/business-plan')),
  budget: () => fetchJson(endpoint('bi', '/budget')),
  recommendations: () => fetchJson<BiRecommendation[]>(endpoint('bi', '/recommendations')),
  generateReport: (type: string) =>
    fetchJson<BiReport>(endpoint('bi', '/reports/generate'), { method: 'POST', body: JSON.stringify({ type }) }),
  reports: () => fetchJson<BiReport[]>(endpoint('bi', '/reports')),
};

// ============================================================================
// OSINT-Engine
// ============================================================================

export const osintApi = {
  trends: (keyword?: string) => fetchJson<TrendData[]>(endpoint('osint', `/trends${keyword ? `?keyword=${keyword}` : ''}`)),
  targets: () => fetchJson(endpoint('osint', '/targets')),
  customers: () => fetchJson(endpoint('osint', '/competitors')),
  scan: (targetId: string) => fetchJson(endpoint('osint', '/scan'), { method: 'POST', body: JSON.stringify({ targetId }) }),
  scanAll: () => fetchJson(endpoint('osint', '/scan-all'), { method: 'POST' }),
};

// ============================================================================
// Aggregierter Dashboard-Status für den Splash-Screen
// ============================================================================

export async function getFleetStatus(): Promise<{
  modules: Record<string, { online: boolean; error?: string }>;
  totals: { online: number; total: number };
}> {
  const moduleKeys = Object.keys(ports);
  const results = await Promise.allSettled(
    moduleKeys.map(async (key) => {
      const res = await fetch(endpoint(key as keyof typeof ports, '/health'), { signal: AbortSignal.timeout(2500) });
      return res.ok;
    })
  );

  const modules: Record<string, { online: boolean; error?: string }> = {};
  results.forEach((r, i) => {
    modules[moduleKeys[i]] = r.status === 'fulfilled' && r.value === true
      ? { online: true }
      : { online: false, error: r.status === 'rejected' ? r.reason?.message : 'unreachable' };
  });

  const online = Object.values(modules).filter(m => m.online).length;
  return { modules, totals: { online, total: moduleKeys.length } };
}