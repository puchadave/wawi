import { z } from 'zod';

// The production UI is reverse-proxied through nginx, so API calls must use
// the current browser origin instead of localhost inside the user's browser.
const API_BASE = import.meta.env.VITE_API_URL || '/api';

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
}

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  fullName: string | null;
  roles: string[];
  permissions: string[];
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  user: AuthUser;
}

let currentTokens: AuthTokens | null = null;
let currentUser: AuthUser | null = null;
let refreshPromise: Promise<boolean> | null = null;

function loadFromStorage(): void {
  try {
    const stored = localStorage.getItem('wawi_auth');
    if (stored) {
      const parsed = JSON.parse(stored);
      currentTokens = parsed.tokens;
      currentUser = parsed.user;
    }
  } catch {
    localStorage.removeItem('wawi_auth');
  }
}

function saveToStorage(): void {
  if (currentTokens && currentUser) {
    localStorage.setItem('wawi_auth', JSON.stringify({
      tokens: currentTokens,
      user: currentUser,
    }));
  } else {
    localStorage.removeItem('wawi_auth');
  }
}

loadFromStorage();

export function getAccessToken(): string | null {
  return currentTokens?.accessToken || null;
}

export function getCurrentUser(): AuthUser | null {
  return currentUser;
}

export function isLoggedIn(): boolean {
  return !!currentTokens?.accessToken && !!currentUser;
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Login fehlgeschlagen' }));
    throw new Error(error.error || 'Login fehlgeschlagen');
  }

  const data: LoginResponse = await response.json();
  currentTokens = {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    csrfToken: data.csrfToken,
  };
  currentUser = data.user;
  saveToStorage();
  return data.user;
}

export async function logout(): Promise<void> {
  if (currentTokens) {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${currentTokens.accessToken}`,
          'X-CSRF-Token': currentTokens.csrfToken,
        },
      });
    } catch {
      // Logout even if server call fails
    }
  }
  currentTokens = null;
  currentUser = null;
  saveToStorage();
}

export async function refreshAccessToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      if (!currentTokens?.refreshToken) return false;

      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: currentTokens.refreshToken }),
      });

      if (!response.ok) {
        currentTokens = null;
        currentUser = null;
        saveToStorage();
        return false;
      }

      const data = await response.json();
      currentTokens = {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        csrfToken: data.csrfToken,
      };
      saveToStorage();
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function apiFetch<T = unknown>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const makeRequest = async (token: string): Promise<Response> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(currentTokens?.csrfToken ? { 'X-CSRF-Token': currentTokens.csrfToken } : {}),
      ...(options.headers as Record<string, string> || {}),
    };

    return fetch(`${API_BASE}${url}`, {
      ...options,
      headers,
      credentials: 'include',
    });
  };

  if (!currentTokens?.accessToken) {
    throw new Error('Not authenticated');
  }

  let response = await makeRequest(currentTokens.accessToken);

  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed && currentTokens?.accessToken) {
      response = await makeRequest(currentTokens.accessToken);
    } else {
      currentTokens = null;
      currentUser = null;
      saveToStorage();
      throw new Error('Session expired');
    }
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}
