import { api } from './api';

export interface AiProvider {
  id: string;
  name: string;
  type: 'openai' | 'anthropic' | 'openai-compatible';
  endpoint?: string | null;
  apiKeyEnvVar?: string | null;
  authSecretId?: string | null;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AiModel {
  id: string;
  providerId: string | null;
  modelName: string;
  config?: Record<string, unknown> | null;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AiPrompt {
  id: string;
  name: string;
  version: string;
  template: string;
  contextVariables?: string[] | null;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AiProcessingChange {
  field: string;
  originalValue: string | null;
  modifiedValue: string;
  processor: string;
  model: string;
  promptVersion: string;
  timestamp: string;
}

export interface AiProcessingRun {
  id: string;
  productId: string | null;
  modelId: string | null;
  promptId: string | null;
  runName: string;
  changes: AiProcessingChange[];
  inputSnapshot: Record<string, unknown>;
  outputSnapshot: Record<string, unknown>;
  status: string;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiProcessorInfo {
  name: string;
  label: string;
  description: string;
  fields: string[];
}

export interface AiRunRequest {
  productId: string;
  providerId: string;
  modelId: string;
  promptId?: string | null;
  processorNames: string[];
  targetLanguage?: string | null;
  options?: {
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
  };
}

async function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const res = await api.get<T>(url, { params });
  return res.data;
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await api.post<T>(url, body);
  return res.data;
}

async function patch<T>(url: string, body?: unknown): Promise<T> {
  const res = await api.patch<T>(url, body);
  return res.data;
}

export const aiApi = {
  // Provider
  listProviders: () => get<{ providers: AiProvider[] }>('/admin/ai/providers').then((r) => r.providers),
  getProvider: (id: string) => get<{ provider: AiProvider }>(`/admin/ai/providers/${id}`).then((r) => r.provider),
  createProvider: (body: Partial<AiProvider> & { name: string; type: AiProvider['type'] }) =>
    post<{ provider: AiProvider }>('/admin/ai/providers', body).then((r) => r.provider),
  updateProvider: (id: string, body: Partial<AiProvider>) =>
    patch<{ provider: AiProvider }>(`/admin/ai/providers/${id}`, body).then((r) => r.provider),
  deleteProvider: (id: string) => api.delete(`/admin/ai/providers/${id}`),
  testProvider: (id: string) =>
    post<{ result: { ok: boolean; latencyMs: number; detail: string }; providerId: string }>(
      `/admin/ai/providers/${id}/test`,
    ),

  // Model
  listModels: () => get<{ models: AiModel[] }>('/admin/ai/models').then((r) => r.models),
  getModel: (id: string) => get<{ model: AiModel }>(`/admin/ai/models/${id}`).then((r) => r.model),
  createModel: (body: { providerId: string; modelName: string; config?: Record<string, unknown>; isEnabled?: boolean }) =>
    post<{ model: AiModel }>('/admin/ai/models', body).then((r) => r.model),
  updateModel: (id: string, body: Partial<AiModel>) =>
    patch<{ model: AiModel }>(`/admin/ai/models/${id}`, body).then((r) => r.model),
  deleteModel: (id: string) => api.delete(`/admin/ai/models/${id}`),

  // Prompt
  listPrompts: () => get<{ prompts: AiPrompt[] }>('/admin/ai/prompts').then((r) => r.prompts),
  getPrompt: (id: string) => get<{ prompt: AiPrompt }>(`/admin/ai/prompts/${id}`).then((r) => r.prompt),
  createPrompt: (body: { name: string; version: string; template: string; contextVariables?: string[]; isEnabled?: boolean }) =>
    post<{ prompt: AiPrompt }>('/admin/ai/prompts', body).then((r) => r.prompt),
  updatePrompt: (id: string, body: Partial<AiPrompt>) =>
    patch<{ prompt: AiPrompt }>(`/admin/ai/prompts/${id}`, body).then((r) => r.prompt),
  deletePrompt: (id: string) => api.delete(`/admin/ai/prompts/${id}`),

  // Processors (available)
  listProcessors: () =>
    get<{ processors: AiProcessorInfo[] }>('/admin/ai/processors').then((r) => r.processors),

  // Runs
  listRuns: (params?: { productId?: string; limit?: number; offset?: number }) =>
    get<{ runs: AiProcessingRun[] }>('/admin/ai/runs', params as Record<string, unknown>).then((r) => r.runs),
  getRun: (id: string) => get<{ run: AiProcessingRun }>(`/admin/ai/runs/${id}`).then((r) => r.run),

  // Execute pipeline
  run: (body: AiRunRequest) =>
    post<{ runId: string; status: string; changes: AiProcessingChange[]; outputSnapshot: Record<string, unknown> }>(
      '/admin/ai/run',
      body,
    ),
};
