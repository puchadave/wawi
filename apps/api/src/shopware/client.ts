import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

interface OAuthResponse {
  access_token: string;
  expires_in?: number;
}

interface ShopwareErrorBody {
  errors?: Array<{ code?: string; status?: string; title?: string; detail?: string }>;
  message?: string;
}

export class ShopwareApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(message);
    this.name = 'ShopwareApiError';
  }
}

export class ShopwareClient {
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;

  constructor(config?: { baseUrl?: string; clientId?: string; clientSecret?: string }) {
    this.baseUrl = (config?.baseUrl || process.env.SHOPWARE_API_URL || '').replace(/\/$/, '');
    this.clientId = config?.clientId || process.env.SHOPWARE_CLIENT_ID || '';
    this.clientSecret = config?.clientSecret || process.env.SHOPWARE_CLIENT_SECRET || '';
  }

  isConfigured() {
    return Boolean(this.baseUrl && this.clientId && this.clientSecret);
  }

  async sync(data: unknown) {
    return this.request('/api/_action/sync', { method: 'POST', body: JSON.stringify(data) });
  }

  async patchStock(productId: string, stock: number) {
    return this.request(`/api/product/${productId}`, {
      method: 'PATCH',
      body: JSON.stringify({ stock }),
    });
  }

  private async authenticate(force = false) {
    if (!this.isConfigured()) {
      throw new Error('Shopware API is not configured');
    }
    if (!force && this.accessToken && Date.now() < this.accessTokenExpiresAt) return;

    const response = await fetch(`${this.baseUrl}/api/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });

    if (!response.ok) {
      throw await this.createError(response, 'Shopware authentication failed');
    }

    const data = await response.json() as OAuthResponse;
    if (!data.access_token) throw new Error('Shopware authentication returned no access token');
    this.accessToken = data.access_token;
    this.accessTokenExpiresAt = Date.now() + Math.max(30, (data.expires_in || 600) - 30) * 1000;
  }

  private async request(pathname: string, init: RequestInit, attempt = 0): Promise<unknown> {
    await this.authenticate(attempt > 0);
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
        ...init.headers,
      },
    });

    if (response.status === 401 && attempt === 0) {
      this.accessToken = null;
      return this.request(pathname, init, 1);
    }

    if (!response.ok) {
      throw await this.createError(response, 'Shopware request failed');
    }

    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  private async createError(response: Response, fallback: string) {
    const text = await response.text();
    let body: ShopwareErrorBody | string = text;
    try {
      body = text ? JSON.parse(text) as ShopwareErrorBody : {};
    } catch {
      body = text;
    }
    const firstError = typeof body === 'object' ? body.errors?.[0] : undefined;
    const detail = firstError?.detail || firstError?.title || (typeof body === 'object' ? body.message : body);
    return new ShopwareApiError(`${fallback}: ${response.status}${detail ? ` - ${detail}` : ''}`, response.status, body);
  }
}

export const shopwareClient = new ShopwareClient();
