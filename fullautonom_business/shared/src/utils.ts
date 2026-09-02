import { DomainEvent, EventType, ModuleId } from './types/index.js';
import { createHash } from 'crypto';

// ============================================================================
// Event Helpers
// ============================================================================

export function createDomainEvent<T>(
  type: EventType,
  source: ModuleId,
  payload: T,
  metadata?: Record<string, unknown>
): DomainEvent<T> {
  return {
    id: crypto.randomUUID(),
    type,
    source,
    timestamp: new Date(),
    payload,
    metadata,
    correlationId: crypto.randomUUID(),
  };
}

// ============================================================================
// Validation Helpers
// ============================================================================

export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function validatePhone(phone: string): boolean {
  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  return phoneRegex.test(phone.replace(/[\s\-()]/g, ''));
}

export function validateUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Money Helpers
// ============================================================================

export function roundToCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function formatCurrency(amount: number, currency: string = 'EUR'): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency,
  }).format(amount);
}

export function calculateVat(gross: number, rate: number = 0.19): number {
  return roundToCents(gross * rate);
}

export function extractNet(gross: number, rate: number = 0.19): number {
  return roundToCents(gross / (1 + rate));
}

export function applyCharmPricing(gross: number, thresholds: number[] = [0.90]): number {
  const floored = Math.floor(gross);
  for (const t of thresholds) {
    const candidate = floored + t;
    if (candidate >= gross) return roundToCents(candidate);
  }
  return roundToCents(floored + 1);
}

// ============================================================================
// Time Helpers
// ============================================================================

export function isWithinDuration(date: Date, durationMs: number): boolean {
  return Date.now() - date.getTime() <= durationMs;
}

export function getUptime(): number {
  return process.uptime();
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// ============================================================================
// Hash Helpers
// ============================================================================

export function generateHash(data: string, algorithm: string = 'sha256'): string {
  return createHash(algorithm).update(data).digest('hex').slice(0, 16);
}

export function generateShortId(): string {
  return crypto.randomUUID().slice(0, 8);
}

// ============================================================================
// Score Helpers
// ============================================================================

export function normalizeScore(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

export function leadScore(
  engagementRate: number,
  followers: number,
  purchaseHistory: number,
  recencyDays: number
): number {
  const engagement = normalizeScore(engagementRate, 0, 10) * 30;
  const audience = normalizeScore(followers, 0, 100000) * 25;
  const purchases = normalizeScore(purchaseHistory, 0, 20) * 30;
  const recency = normalizeScore(365 - recencyDays, 0, 365) * 15;
  return Math.round(engagement + audience + purchases + recency);
}

export function calculateHealthScore(metrics: {
  uptime: number;
  errorRate: number;
  latency: number;
  throughput: number;
}): number {
  const uptimeScore = Math.min(metrics.uptime / 99.9, 1) * 30;
  const errorScore = (1 - Math.min(metrics.errorRate, 1)) * 25;
  const latencyScore = (1 - Math.min(metrics.latency / 5000, 1)) * 25;
  const throughputScore = Math.min(metrics.throughput / 1000, 1) * 20;
  return Math.round(uptimeScore + errorScore + latencyScore + throughputScore);
}

// ============================================================================
// Slug Helpers
// ============================================================================

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ============================================================================
// Retry Helpers
// ============================================================================

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { retries?: number; delayMs?: number; backoff?: number; shouldRetry?: (error: unknown) => boolean } = {}
): Promise<T> {
  const { retries = 3, delayMs = 1000, backoff = 2, shouldRetry = () => true } = options;
  
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries || !shouldRetry(error)) break;
      await new Promise(resolve => setTimeout(resolve, delayMs * Math.pow(backoff, attempt)));
    }
  }
  throw lastError;
}

// ============================================================================
// Date Helpers
// ============================================================================

export function startOfDay(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}