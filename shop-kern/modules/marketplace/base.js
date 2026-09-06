'use strict';
/**
 * Marketplace Base Adapter — gemeinsame Logik fuer alle Kanaele
 * - HMAC/fetch via Node stdlib (https/http)
 * - Retry/Backoff, Rate-Limit (Token-Bucket simpel), DryRun
 * - Secrets via config.json > env Fallback, nie im Log
 * - Kontinuierliches Debugging via logger
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { logger } = require('../logger');

const DEFAULT_RATES = {
  kaufland: { rps: 2 },
  otto: { rps: 5 },
  ebay: { rps: 5 },
  kleinanzeigen: { rps: 1 },
};

function maskSecret(v) {
  if (!v) return '';
  const s = String(v);
  if (s.length <= 4) return '****';
  return s.slice(0, 2) + '***' + s.slice(-2);
}

function envFor(channel, key) {
  const map = {
    kaufland: { apiKey: 'KAUFLAND_API_KEY', secret: 'KAUFLAND_SECRET', clientKey: 'KAUFLAND_CLIENT_KEY' },
    otto: { clientId: 'OTTO_CLIENT_ID', clientSecret: 'OTTO_CLIENT_SECRET' },
    ebay: { clientId: 'EBAY_CLIENT_ID', clientSecret: 'EBAY_CLIENT_SECRET', refreshToken: 'EBAY_REFRESH_TOKEN' },
    kleinanzeigen: { bridgeUrl: 'KLEINANZEIGEN_BRIDGE_URL' },
  };
  const envKey = map[channel] && map[channel][key];
  return envKey ? (process.env[envKey] || '') : '';
}

class MarketplaceBase {
  constructor(channel, catalogManager, getConfig, orderManager = null) {
    this.channel = String(channel);
    this.catalogManager = catalogManager;
    this.getConfig = getConfig;
    this.orderManager = orderManager;
    this.lastRequestTs = 0;
    const rate = DEFAULT_RATES[this.channel] || { rps: 2 };
    this.minIntervalMs = Math.ceil(1000 / rate.rps);
  }

  getChannelConfig() {
    const cfg = this.getConfig() || {};
    const mp = cfg.marketplace && cfg.marketplace[this.channel] ? cfg.marketplace[this.channel] : {};
    // env fallback
    const out = { ...mp };
    if (this.channel === 'kaufland') {
      if (!out.apiKey) out.apiKey = envFor('kaufland', 'apiKey');
      if (!out.secret) out.secret = envFor('kaufland', 'secret');
      if (!out.clientKey) out.clientKey = envFor('kaufland', 'clientKey');
    } else if (this.channel === 'otto') {
      if (!out.clientId) out.clientId = envFor('otto', 'clientId');
      if (!out.clientSecret) out.clientSecret = envFor('otto', 'clientSecret');
    } else if (this.channel === 'ebay') {
      if (!out.clientId) out.clientId = envFor('ebay', 'clientId');
      if (!out.clientSecret) out.clientSecret = envFor('ebay', 'clientSecret');
      if (!out.refreshToken) out.refreshToken = envFor('ebay', 'refreshToken');
    } else if (this.channel === 'kleinanzeigen') {
      if (!out.bridgeUrl) out.bridgeUrl = envFor('kleinanzeigen', 'bridgeUrl');
    }
    return out;
  }

  isDryRun() {
    const c = this.getChannelConfig();
    if (c.mode === 'dryRun') return true;
    if (c.enabled === false) return true;
    // wenn kein Secret aber enabled true -> trotzdem dryRun bis Credentials da
    if (this.channel === 'kaufland' && (!c.apiKey || !c.secret)) return true;
    if (this.channel === 'otto' && (!c.clientId || !c.clientSecret)) return true;
    if (this.channel === 'ebay' && (!c.clientId || !c.clientSecret)) return true;
    return c.mode === 'dryRun' || c.enabled !== true;
  }

  isEnabled() {
    const c = this.getChannelConfig();
    return c.enabled === true;
  }

  async rateLimit() {
    const now = Date.now();
    const elapsed = now - this.lastRequestTs;
    if (elapsed < this.minIntervalMs) {
      const wait = this.minIntervalMs - elapsed;
      await new Promise(r => setTimeout(r, wait));
    }
    this.lastRequestTs = Date.now();
  }

  async withRetry(fn, opts = {}) {
    const maxRetries = opts.maxRetries != null ? opts.maxRetries : 3;
    let attempt = 0;
    let lastErr;
    while (attempt <= maxRetries) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const status = err.statusCode || err.status || 0;
        const isRetryable = status === 429 || status >= 500 || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT';
        if (!isRetryable || attempt === maxRetries) throw err;
        let delay = 300 * Math.pow(2, attempt);
        if (status === 429 && err.retryAfterMs) delay = err.retryAfterMs;
        else if (status === 429 && err.headers && err.headers['retry-after']) {
          const ra = parseInt(err.headers['retry-after'], 10);
          if (!isNaN(ra)) delay = ra * 1000;
        }
        logger.warn('MARKETPLACE', `${this.channel} retry ${attempt + 1}/${maxRetries} nach ${delay}ms (status ${status})`, { channel: this.channel, error: err.message });
        await new Promise(r => setTimeout(r, delay));
        attempt++;
      }
    }
    throw lastErr;
  }

  buildUrl(baseUrl, pathPart) {
    const base = String(baseUrl || '').replace(/\/$/, '');
    const p = String(pathPart || '');
    if (!p) return base;
    if (p.startsWith('http')) return p;
    return base + (p.startsWith('/') ? p : '/' + p);
  }

  httpRequest(urlStr, method, headers, bodyStr, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const u = new URL(urlStr);
      const lib = u.protocol === 'https:' ? https : http;
      const opts = {
        method,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        headers,
      };
      const req = lib.request(opts, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const ct = res.headers['content-type'] || '';
          let parsed = data;
          if (ct.includes('application/json')) {
            try { parsed = JSON.parse(data); } catch { /* keep raw */ }
          }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed, raw: data });
          } else {
            const err = new Error(`HTTP ${res.statusCode}: ${String(data).slice(0, 500)}`);
            err.statusCode = res.statusCode;
            err.headers = res.headers;
            err.body = parsed;
            if (res.headers['retry-after']) err.retryAfterMs = parseInt(res.headers['retry-after'], 10) * 1000;
            reject(err);
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(timeoutMs, () => { req.destroy(new Error('ETIMEDOUT')); });
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }

  async request(method, pathPart, body = null, extra = {}) {
    await this.rateLimit();
    const cfg = this.getChannelConfig();
    const baseUrl = extra.baseUrl || cfg.baseUrl || '';
    const url = this.buildUrl(baseUrl, pathPart);
    const headers = { 'Accept': 'application/json', ...(extra.headers || {}) };
    let bodyStr = null;
    if (body != null) {
      if (typeof body === 'string') { bodyStr = body; headers['Content-Type'] = headers['Content-Type'] || 'text/plain'; }
      else { bodyStr = JSON.stringify(body); headers['Content-Type'] = headers['Content-Type'] || 'application/json'; }
      headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }
    // Hook fuer Signatur (Kaufland)
    if (extra.sign) {
      const sigHeaders = extra.sign({ method, url, bodyStr, headers, cfg });
      Object.assign(headers, sigHeaders);
    }
    const maskedHeaders = { ...headers };
    if (maskedHeaders['Authorization']) maskedHeaders['Authorization'] = '***';
    logger.debug('MARKETPLACE', `${this.channel} ${method} ${url}`, { channel: this.channel, headers: maskedHeaders });
    return this.withRetry(() => this.httpRequest(url, method, headers, bodyStr, extra.timeoutMs), extra);
  }

  logDryRun(action, payload) {
    const entry = { ts: new Date().toISOString(), channel: this.channel, action, payload };
    logger.info('MARKETPLACE', `[DRYRUN] ${this.channel} ${action}`, { channel: this.channel, action });
    try {
      const logFile = path.join(__dirname, '../../data/marketplace_dryrun.log');
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
    } catch (e) {
      logger.warn('MARKETPLACE', `dryRun log append failed: ${e.message}`);
    }
    return entry;
  }

  // Standard-Interface — von Subklassen ueberschrieben
  async healthCheck() {
    const dry = this.isDryRun();
    const enabled = this.isEnabled();
    return { channel: this.channel, enabled, dryRun: dry, ok: true, message: dry ? 'DryRun aktiv (kein Live-Call)' : 'Bereit' };
  }
  async pushProduct(_productId) { throw new Error('pushProduct nicht implementiert'); }
  async pushStock(_productId) { throw new Error('pushStock nicht implementiert'); }
  async pushPrice(_productId) { throw new Error('pushPrice nicht implementiert'); }
  async importOrders(_since) { return { imported: 0, orders: [] }; }
  async pushTracking(_orderId, _tracking) { return { ok: false, dryRun: this.isDryRun() }; }
}

module.exports = { MarketplaceBase, maskSecret };
