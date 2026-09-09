/**
 * AI Provider Adapter — modulare Schnittstelle zu KI-Anbietern.
 *
 * Architekturprinzip:
 *  - Kein KI-Anbieter ist fest in der Kernlogik verdrahtet.
 *  - Der konkrete Adapter wird per `createAiAdapter(provider)` anhand des
 *    `type`-Feldes des Providers instanziiert (openai / anthropic / openai-compatible).
 *  - API-Keys werden ausschliesslich aus Umgebungsvariablen geloest
 *    (`ai_providers.apiKeyEnvVar`), niemals aus der Datenbank oder dem Code.
 */

export type AiProviderType = 'openai' | 'anthropic' | 'openai-compatible';

export interface AiProviderConfig {
  id: string;
  name: string;
  type: AiProviderType;
  endpoint?: string | null;
  apiKeyEnvVar?: string | null;
}

export interface AiGenerateRequest {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface AiGenerateResponse {
  text: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface AiProviderAdapter {
  readonly providerType: AiProviderType;
  generate(request: AiGenerateRequest): Promise<AiGenerateResponse>;
  /** Prueft Erreichbarkeit des Endpunkts mit einem minimalen Request. */
  test(): Promise<{ ok: boolean; latencyMs: number; detail: string }>;
}

export class AiAdapterError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly providerBody?: string
  ) {
    super(message);
  }
}

/** Standard-Endpunkte, nur als Fallback wenn kein eigener `endpoint` konfiguriert ist. */
const DEFAULT_ENDPOINTS: Record<AiProviderType, string> = {
  openai: 'https://api.openai.com/v1',
  'openai-compatible': 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
};

function resolveEndpoint(provider: AiProviderConfig, path: string): string {
  const base = (provider.endpoint?.trim() || DEFAULT_ENDPOINTS[provider.type]).replace(/\/+$/, '');
  return `${base}/${path.replace(/^\/+/, '')}`;
}

function resolveApiKey(provider: AiProviderConfig): string | null {
  const envVar = provider.apiKeyEnvVar?.trim() || `${provider.type.toUpperCase().replace('-', '_')}_API_KEY`;
  const key = process.env[envVar] || process.env[provider.apiKeyEnvVar || ''];
  return key && key.trim() ? key.trim() : null;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new AiAdapterError(`Timeout nach ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([fetch(url, init), timeoutPromise]);
}

async function parseErrorResponse(response: Response, providerName: string): Promise<AiAdapterError> {
  let bodyText = '';
  try {
    bodyText = await response.text();
  } catch {
    bodyText = '';
  }
  const detail = bodyText.length > 400 ? `${bodyText.slice(0, 400)}…` : bodyText;
  return new AiAdapterError(
    `KI-Anbieter "${providerName}" antwortete mit HTTP ${response.status}`,
    response.status,
    detail
  );
}

/** OpenAI- und OpenAI-kompatible Chat-Completions-API (ChatGPT-ähnliche Endpunkte). */
class OpenAICompatibleAdapter implements AiProviderAdapter {
  readonly providerType: AiProviderType = 'openai-compatible';

  constructor(private readonly provider: AiProviderConfig) {}

  async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    const apiKey = resolveApiKey(this.provider);
    if (!apiKey) {
      throw new AiAdapterError(
        `Kein API-Key fuer Provider "${this.provider.name}" gefunden. ` +
        `Setze die Umgebungsvariable "${this.provider.apiKeyEnvVar || 'OPENAI_API_KEY'}".`
      );
    }

    const response = await fetchWithTimeout(
      resolveEndpoint(this.provider, 'chat/completions'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: request.model,
          messages: [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: request.userPrompt },
          ],
          temperature: request.temperature ?? 0.3,
          max_tokens: request.maxTokens ?? 2048,
        }),
      },
      request.timeoutMs ?? 60000
    );

    if (!response.ok) {
      throw await parseErrorResponse(response, this.provider.name);
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content?.trim() || '';
    if (!text) {
      throw new AiAdapterError(
        `KI-Anbieter "${this.provider.name}" lieferte eine leere Antwort.`,
        response.status
      );
    }

    return {
      text,
      usage: {
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        totalTokens: data.usage?.total_tokens,
      },
    };
  }

  async test(): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
    const apiKey = resolveApiKey(this.provider);
    if (!apiKey) {
      return {
        ok: false,
        latencyMs: 0,
        detail: `API-Key fehlt: "${this.provider.apiKeyEnvVar || 'OPENAI_API_KEY'}" ist nicht gesetzt`,
      };
    }
    const started = Date.now();
    try {
      const response = await fetchWithTimeout(
        this.provider.endpoint?.trim()
          ? resolveEndpoint(this.provider, 'models')
          : 'https://api.openai.com/v1/models',
        { headers: { Authorization: `Bearer ${apiKey}` } },
        10000
      );
      const latencyMs = Date.now() - started;
      if (!response.ok) {
        const err = await parseErrorResponse(response, this.provider.name);
        return { ok: false, latencyMs, detail: err.message };
      }
      return { ok: true, latencyMs, detail: `Endpunkt erreichbar (HTTP ${response.status})` };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        detail: err instanceof Error ? err.message : 'Unbekannter Fehler',
      };
    }
  }
}

/** Anthropic Messages API. */
class AnthropicAdapter implements AiProviderAdapter {
  readonly providerType: AiProviderType = 'anthropic';

  constructor(private readonly provider: AiProviderConfig) {}

  async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    const apiKey = resolveApiKey(this.provider);
    if (!apiKey) {
      throw new AiAdapterError(
        `Kein API-Key fuer Provider "${this.provider.name}" gefunden. ` +
        `Setze die Umgebungsvariable "${this.provider.apiKeyEnvVar || 'ANTHROPIC_API_KEY'}".`
      );
    }

    const response = await fetchWithTimeout(
      resolveEndpoint(this.provider, 'messages'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: request.model,
          system: request.systemPrompt,
          messages: [{ role: 'user', content: request.userPrompt }],
          max_tokens: request.maxTokens ?? 2048,
          temperature: request.temperature ?? 0.3,
        }),
      },
      request.timeoutMs ?? 60000
    );

    if (!response.ok) {
      throw await parseErrorResponse(response, this.provider.name);
    }

    const data = (await response.json()) as {
      content?: { type?: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = (data.content || [])
      .filter((block) => block.type === 'text' && block.text)
      .map((block) => block.text!.trim())
      .join('\n')
      .trim();

    if (!text) {
      throw new AiAdapterError(
        `KI-Anbieter "${this.provider.name}" lieferte eine leere Antwort.`,
        response.status
      );
    }

    return {
      text,
      usage: {
        promptTokens: data.usage?.input_tokens,
        completionTokens: data.usage?.output_tokens,
        totalTokens: data.usage?.input_tokens !== undefined && data.usage?.output_tokens !== undefined
          ? data.usage.input_tokens + data.usage.output_tokens
          : undefined,
      },
    };
  }

  async test(): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
    const apiKey = resolveApiKey(this.provider);
    if (!apiKey) {
      return {
        ok: false,
        latencyMs: 0,
        detail: `API-Key fehlt: "${this.provider.apiKeyEnvVar || 'ANTHROPIC_API_KEY'}" ist nicht gesetzt`,
      };
    }
    const started = Date.now();
    try {
      const response = await fetchWithTimeout(
        resolveEndpoint(this.provider, 'models'),
        { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } },
        10000
      );
      const latencyMs = Date.now() - started;
      if (!response.ok) {
        const err = await parseErrorResponse(response, this.provider.name);
        return { ok: false, latencyMs, detail: err.message };
      }
      return { ok: true, latencyMs, detail: `Endpunkt erreichbar (HTTP ${response.status})` };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        detail: err instanceof Error ? err.message : 'Unbekannter Fehler',
      };
    }
  }
}

export function createAiAdapter(provider: AiProviderConfig): AiProviderAdapter {
  switch (provider.type) {
    case 'openai':
    case 'openai-compatible':
      return new OpenAICompatibleAdapter({ ...provider, type: 'openai-compatible' });
    case 'anthropic':
      return new AnthropicAdapter(provider);
    default:
      throw new AiAdapterError(`Unbekannter KI-Anbietertyp: ${provider.type}`);
  }
}