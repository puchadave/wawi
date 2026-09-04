import axios from 'axios';

// In production the web UI and API are served behind the same nginx origin.
// Using a relative URL avoids hard-coded localhost requests in the browser.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: {
    'Content-Type': 'application/json',
  },
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
  status: ProductStatus;
  isWhitelisted: boolean;
  createdAt: string;
  updatedAt: string;
  manualData: ProductContent;
  aiData: ProductContent;
  variants?: ProductVariant[];
  syncAttempt?: SyncAttempt | null;
  shopwareMapping?: ShopwareMapping | null;
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
  bulkApprove: (ids: string[]) =>
    post<{ status: 'approved'; count: number }>('/products/bulk-approve', { ids }),
};

export const pricingApi = {
  getRules: () => get<PriceRule[]>('/pricing/rules'),
  createRule: (data: unknown) => post<PriceRule>('/pricing/rules', data),
  updateRule: (id: string, data: unknown) => put<{ message: string; id: string }>(`/pricing/rules/${id}`, data),
  calculate: (data: { supplierNet: number; dropshippingFeeNet?: number; freightAllocatedNet?: number; priceRuleId: string }) =>
    post<PricingCalculationResult>('/pricing/calculate', data),
  simulate: (priceRuleId: string) =>
    post<{ message: string; affectedProductCount: number }>('/pricing/simulate', { priceRuleId }),
  apply: (priceRuleId: string) => post<{ message: string }>('/pricing/apply', { priceRuleId }),
};

export const importApi = {
  uploadWhitelist: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return post<{ message: string; importedCount: number }>('/import/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};
