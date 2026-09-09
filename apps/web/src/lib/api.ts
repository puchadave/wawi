import axios from 'axios';
import { getAccessToken } from './auth';

// In production the web UI and API are served behind the same nginx origin.
// Using a relative URL avoids hard-coded localhost requests in the browser.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
    const csrf = (() => {
      try {
        const raw = localStorage.getItem('wawi_auth');
        if (!raw) return null;
        return (JSON.parse(raw).tokens as { csrfToken?: string })?.csrfToken ?? null;
      } catch { return null; }
    })();
    if (csrf) config.headers['x-csrf-token'] = csrf;
  }
  return config;
});

async function get<T>(url: string, config?: Parameters<typeof api.get>[1]): Promise<T> {
  const response = await api.get<T>(url, config);
  return response.data;
}

async function post<T>(url: string, data?: unknown, config?: Parameters<typeof api.post>[2]): Promise<T> {
  const response = await api.post<T>(url, data, config);
  return response.data;
}

async function put<T>(url: string, data?: unknown): Promise<T> {
  const response = await api.put<T>(url, data);
  return response.data;
}

async function patch<T>(url: string, data?: unknown): Promise<T> {
  const response = await api.patch<T>(url, data);
  return response.data;
}

export type ProductStatus = 'imported' | 'reviewed' | 'approved' | 'synced' | 'rejected';

export interface ProductContent {
  title?: string;
  description?: string;
  metaTitle?: string;
  metaDescription?: string;
}

export interface ProductVariant {
  supplierVariantId: string;
  supplierProductId: string;
  name: string;
  stock: number;
  availableIn: number;
  ean: string | null;
  updatedAt: string;
}

export interface SyncAttempt {
  id: string;
  supplierProductId: string;
  jobId: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed';
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShopwareMapping {
  shopwareUuid: string;
  syncedAt: string;
}

export interface Product {
  supplierProductId: string;
  name: string;
  brand: string;
  categoryPath: string;
  categoryId: string;
  color: string | null;
  type: string | null;
  descriptionHtml: string | null;
  images: string[];
  prices: Record<string, number>;
  aiData: ProductContent;
  manualData: ProductContent;
  attributes: Record<string, unknown>;
  status: ProductStatus;
  isWhitelisted: boolean;
  createdAt: string;
  updatedAt: string;
  variants: ProductVariant[];
  shopwareMappings: ShopwareMapping[];
  syncAttempts: SyncAttempt[];
}

export interface ProductListParams {
  status?: ProductStatus;
  brand?: string;
  categoryId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ProductListResponse {
  products: Product[];
  count: number;
  limit: number;
  offset: number;
}

export interface PriceRule {
  id: string;
  name: string;
  vatRate: number;
  targetMargin: number;
  fixedSurchargeNet: number;
  mode: 'netto' | 'brutto';
  charmPricing: boolean;
  includeFreightInVk: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface PricingCalculationResult {
  supplierNet: number;
  dropshippingFeeNet: number;
  freightAllocatedNet: number;
  fixedSurchargeNet: number;
  shopEkNet: number;
  shopVkNet: number;
  shopVkGross: number;
  vatAmount: number;
  marginAmountNet: number;
  marginPercent: number;
}

export const productApi = {
  list: (params?: ProductListParams) => get<ProductListResponse>('/products', { params }),
  getReviewQueue: (limit = 50, offset = 0) =>
    get<ProductListResponse>('/products/review', { params: { limit, offset } }),
  getById: (id: string) => get<Product>(`/products/${id}`),
  saveManualData: (id: string, manualData: ProductContent) =>
    patch<Product>(`/products/${id}/manual-data`, manualData),
  approve: (id: string) => post<{ status: 'approved'; id: string }>(`/products/${id}/approve`),
  reject: (id: string) => post<{ status: 'rejected'; id: string }>(`/products/${id}/reject`),
  review: (id: string) => post<{ status: 'reviewed'; id: string }>(`/products/${id}/review`),
  sync: (id: string) => post<{ status: 'queued'; id: string; attemptId: string; jobId: string }>(`/products/${id}/sync`),
  retrySync: (id: string) => post<{ status: 'queued'; id: string; attemptId: string; jobId: string }>(`/products/${id}/sync/retry`),
  bulkApprove: (ids: string[]) =>
    post<{ status: 'approved'; count: number }>('/products/bulk/approve', { ids }),
  updateAttributes: (id: string, attributes: Record<string, unknown>) =>
    patch<Product>(`/products/${id}/attributes`, { attributes }),
};

export const pricingApi = {
  getRules: () => get<PriceRule[]>('/admin/pricing/rules'),
  createRule: (data: Omit<PriceRule, 'id' | 'createdAt' | 'updatedAt'>) =>
    post<PriceRule>('/admin/pricing/rules', data),
  updateRule: (id: string, data: Partial<PriceRule>) =>
    patch<PriceRule>(`/admin/pricing/rules/${id}`, data),
  deleteRule: (id: string) => api.delete(`/admin/pricing/rules/${id}`),
  calculate: (data: { supplierNet: number; priceRuleId: string; quantity?: number }) =>
    post<PricingCalculationResult>('/admin/pricing/calculate', data),
};

export interface MatterhornConnection {
  id: string;
  name: string;
  type: 'xml' | 'csv' | 'json' | 'api' | 'ftp' | 'sftp' | 'matterhorn';
  endpoint: string | null;
  auth: Record<string, string>;
  mapping: Record<string, string>;
  schedule: string | null;
  isEnabled: boolean;
  lastTestedAt: string | null;
  lastTestResult: { ok: boolean; latencyMs?: number; message?: string } | null;
  createdAt: string;
}

export interface ImportJob {
  id: string;
  connectionId: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  fileName: string | null;
  totalProducts: number;
  importedCount: number;
  failedCount: number;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface ImportLog {
  id: string;
  jobId: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  createdAt: string;
}

export const matterhornApi = {
  listConnections: () => get<{ connections: MatterhornConnection[] }>('/admin/matterhorn/connections'),
  getConnection: (id: string) => get<{ connection: MatterhornConnection }>(`/admin/matterhorn/connections/${id}`),
  createConnection: (data: { name: string; type?: string; endpoint?: string | null; auth?: Record<string, string>; mapping?: Record<string, string>; schedule?: string | null; isEnabled?: boolean }) =>
    post<{ connection: MatterhornConnection }>('/admin/matterhorn/connections', data),
  updateConnection: (id: string, data: Partial<MatterhornConnection>) =>
    patch<{ connection: MatterhornConnection }>(`/admin/matterhorn/connections/${id}`, data),
  deleteConnection: (id: string) => api.delete(`/admin/matterhorn/connections/${id}`),
  testConnection: (id: string) => post<{ result: { ok: boolean; latencyMs: number; message: string }; connectionId: string }>(`/admin/matterhorn/connections/${id}/test`),
  importXml: (connectionId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return post<{ jobId: string; status: string; totalParsed: number; importedCount: number; failedCount: number }>(
      `/admin/matterhorn/connections/${connectionId}/import`,
      fd,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
  },
  listJobs: (params?: { connectionId?: string; limit?: number }) =>
    get<{ jobs: ImportJob[] }>('/admin/matterhorn/jobs', { params }),
  getJob: (id: string) => get<{ job: ImportJob; logs: ImportLog[] }>(`/admin/matterhorn/jobs/${id}`),
  getJobLogs: (id: string) => get<{ logs: ImportLog[] }>(`/admin/matterhorn/jobs/${id}/logs`),
};

export { api };

export interface Integration {
  id: string;
  name: string;
  type: 'ai' | 'matterhorn' | 'shopware' | 'marketplace' | 'custom';
  endpoint: string | null;
  credentials: Record<string, string>;
  isEnabled: boolean;
  lastTestedAt: string | null;
  lastTestResult: { ok: boolean; latencyMs?: number; message?: string } | null;
  createdAt: string;
  updatedAt: string;
}

export const integrationsApi = {
  list: (type?: string) => get<{ integrations: Integration[] }>('/admin/integrations', { params: type ? { type } : {} }),
  getById: (id: string) => get<{ integration: Integration }>(`/admin/integrations/${id}`),
  create: (data: { name: string; type?: string; endpoint?: string | null; credentials?: Record<string, string>; isEnabled?: boolean }) =>
    post<{ integration: Integration }>('/admin/integrations', data),
  update: (id: string, data: Partial<{ name: string; type: string; endpoint: string | null; credentials: Record<string, string>; isEnabled: boolean }>) =>
    patch<{ integration: Integration }>(`/admin/integrations/${id}`, data),
  remove: (id: string) => api.delete(`/admin/integrations/${id}`),
  test: (id: string, override?: { endpoint?: string; credentials?: Record<string, string> }) =>
    post<{ result: { ok: boolean; latencyMs: number; message: string }; integration: Integration }>(`/admin/integrations/${id}/test`, override || {}),
};

export interface ShopwareMapping {
  id: string;
  supplierProductId: string;
  supplierVariantId: string | null;
  shopwareUuid: string;
  entityType: string;
  syncedAt: string;
  productName?: string | null;
}

export interface SyncAttempt {
  id: string;
  supplierProductId: string;
  jobId: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed';
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const shopwareApi = {
  getStatus: () => get<{ envConfigured: boolean; integrations: Integration[]; queue: Record<string, number> | null; queueError: string | null; stats: { mappingsTotal: number; attemptsTotal: number; recentAttempts: SyncAttempt[] } }>('/admin/shopware/status'),
  listMappings: (params?: { supplierProductId?: string; entityType?: string; limit?: number; offset?: number }) =>
    get<{ mappings: ShopwareMapping[]; total: number; limit: number; offset: number }>('/admin/shopware/mappings', { params }),
  listAttempts: (params?: { supplierProductId?: string; status?: string; limit?: number; offset?: number }) =>
    get<{ attempts: SyncAttempt[]; total: number; limit: number; offset: number }>('/admin/shopware/attempts', { params }),
  getQueue: () => get<{ counts: Record<string, number>; sample: { waiting: any[]; active: any[]; failed: any[] } }>('/admin/shopware/queue'),
  retry: (supplierProductId: string) =>
    post<{ status: string; supplierProductId: string; attemptId: string; jobId: string }>(`/admin/shopware/retry/${supplierProductId}`),
};

export interface AdminStats {
  products: { total: number; byStatus: Record<string, number> };
  variants: { total: number };
  imports: { byStatus: Record<string, number>; matterhornConnections: number };
  ai: { byStatus: Record<string, number>; providers: number };
  sync: { failed: number; total: number; mappings: number };
  integrations: { total: number };
  queues: Record<string, unknown>;
  generatedAt: string;
}

export const adminStatsApi = {
  get: () => get<AdminStats>('/admin/stats'),
};

