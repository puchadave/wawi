'use strict';
/**
 * Otto Market Adapter — Partner API (api.otto.market)
 * Auth: OAuth2 Client Credentials, DryRun default
 */

const { MarketplaceBase } = require('./base');
const { logger } = require('../logger');

class OttoAdapter extends MarketplaceBase {
  constructor(catalogManager, getConfig, orderManager) {
    super('otto', catalogManager, getConfig, orderManager);
    this.tokenCache = null; // { token, expMs }
  }

  async getAccessToken() {
    const cfg = this.getChannelConfig();
    if (!cfg.clientId || !cfg.clientSecret) throw new Error('Otto clientId/secret fehlt');
    if (this.tokenCache && this.tokenCache.expMs > Date.now() + 60000) return this.tokenCache.token;
    const url = cfg.tokenUrl || (cfg.baseUrl || 'https://api.otto.market/v1').replace(/\/v1\/?$/, '/v1/token');
    // Standard OAuth2 client_credentials
    const body = `grant_type=client_credentials&client_id=${encodeURIComponent(cfg.clientId)}&client_secret=${encodeURIComponent(cfg.clientSecret)}`;
    const res = await this.request('POST', url, body, {
      baseUrl: '', // url ist absolut
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const token = res.body && (res.body.access_token || res.body.accessToken);
    const expiresIn = (res.body && (res.body.expires_in || res.body.expiresIn)) || 3600;
    if (!token) throw new Error('Otto token response ohne access_token');
    this.tokenCache = { token, expMs: Date.now() + Number(expiresIn) * 1000 };
    logger.debug('MARKETPLACE', 'Otto token erneuert', { channel: 'otto', expiresIn });
    return token;
  }

  async authHeaders() {
    const token = await this.getAccessToken();
    return { 'Authorization': `Bearer ${token}` };
  }

  async healthCheck() {
    const base = await super.healthCheck();
    if (base.dryRun) return { ...base, hint: 'Setze marketplace.otto {enabled:true, clientId, clientSecret} oder OTTO_CLIENT_ID/SECRET' };
    try {
      const headers = await this.authHeaders();
      await this.request('GET', '/products?limit=1', null, { headers });
      return { ...base, ok: true, message: 'Otto API erreichbar' };
    } catch (err) {
      return { ...base, ok: false, message: `Otto Health failed: ${err.message}`, statusCode: err.statusCode };
    }
  }

  async pushProduct(productId) {
    const product = this.catalogManager.getById(productId);
    if (!product) throw new Error(`Produkt ${productId} nicht gefunden`);
    const { mapWaWiToOtto } = require('../mapper');
    const mapped = mapWaWiToOtto(product);
    // Otto erwartet: title, brand, price, quantity, ean, images, longDescription
    const payload = {
      sku: mapped.sku,
      title: mapped.title,
      description: mapped.longDescription,
      brand: mapped.brand,
      price: mapped.price,
      quantity: mapped.quantity,
      ean: mapped.ean || undefined,
      images: mapped.images,
      category: mapped.categoryPath,
      color: mapped.color,
      type: mapped.type,
      variants: mapped.variants,
    };
    if (this.isDryRun()) {
      return { ok: true, dryRun: true, channel: 'otto', productId, payload, log: this.logDryRun('pushProduct', payload) };
    }
    const headers = await this.authHeaders();
    // Otto: PUT /products/{sku} (upsert)
    const res = await this.request('PUT', `/products/${encodeURIComponent(mapped.sku)}`, payload, { headers });
    logger.audit('MARKETPLACE', `Otto pushProduct ${productId} -> ${mapped.sku}`, { channel: 'otto', sku: mapped.sku });
    for (const v of mapped.variants || []) {
      if (!v.sku || v.sku === mapped.sku) continue;
      const vPayload = { ...payload, sku: v.sku, ean: v.ean, quantity: v.stock, price: v.price };
      try { await this.request('PUT', `/products/${encodeURIComponent(v.sku)}`, vPayload, { headers }); } catch (e) { logger.warn('MARKETPLACE', `Otto Variante ${v.sku} failed: ${e.message}`); }
    }
    return { ok: true, channel: 'otto', productId, sku: mapped.sku, response: res.body };
  }

  async pushStock(productId) {
    const product = this.catalogManager.getById(productId);
    if (!product) throw new Error(`Produkt ${productId} nicht gefunden`);
    const payload = { quantity: Number(product.stock || 0) };
    if (this.isDryRun()) return { ok: true, dryRun: true, channel: 'otto', productId, payload, log: this.logDryRun('pushStock', payload) };
    const headers = await this.authHeaders();
    const sku = product.sku || `MH-${product.id}`;
    await this.request('PATCH', `/products/${encodeURIComponent(sku)}/quantity`, payload, { headers });
    for (const v of product.variants || []) {
      const vSku = v.sku || `${sku}-${v.id}`;
      try { await this.request('PATCH', `/products/${encodeURIComponent(vSku)}/quantity`, { quantity: Number(v.stock||0) }, { headers }); } catch (e) { logger.warn('MARKETPLACE', `Otto stock ${vSku} failed: ${e.message}`); }
    }
    return { ok: true, channel: 'otto', productId, quantity: payload.quantity };
  }

  async pushPrice(productId) {
    const product = this.catalogManager.getById(productId);
    if (!product) throw new Error(`Produkt ${productId} nicht gefunden`);
    const { resolveChannelPrice } = require('../mapper');
    const price = Number(resolveChannelPrice(product, 'otto') || product.price || 0);
    const payload = { price };
    if (this.isDryRun()) return { ok: true, dryRun: true, channel: 'otto', productId, payload, log: this.logDryRun('pushPrice', payload) };
    const headers = await this.authHeaders();
    const sku = product.sku || `MH-${product.id}`;
    await this.request('PATCH', `/products/${encodeURIComponent(sku)}/price`, { price }, { headers });
    return { ok: true, channel: 'otto', productId, price };
  }

  async importOrders(since) {
    if (this.isDryRun()) {
      const entry = this.logDryRun('importOrders', { since: since || null });
      return { ok: true, dryRun: true, imported: 0, orders: [], log: entry };
    }
    const headers = await this.authHeaders();
    const qs = since ? `?updatedSince=${encodeURIComponent(since)}` : '';
    const res = await this.request('GET', `/orders${qs}`, null, { headers });
    const rawOrders = (res.body && (res.body.orders || res.body.resources || res.body)) || [];
    const list = Array.isArray(rawOrders) ? rawOrders : [];
    let imported = 0;
    for (const o of list) {
      try {
        const mapped = this.mapOttoOrder(o);
        if (this.orderManager) { this.orderManager.createOrder(mapped); imported++; }
      } catch (e) { logger.warn('MARKETPLACE', `Otto order map failed: ${e.message}`); }
    }
    logger.info('MARKETPLACE', `Otto importOrders: ${imported}/${list.length}`, { channel: 'otto' });
    return { ok: true, imported, total: list.length, orders: list.slice(0, 20) };
  }

  mapOttoOrder(o) {
    const id = String(o.orderId || o.id || o.orderNumber || `OTTO-${Date.now()}`);
    const items = (o.positions || o.items || o.orderItems || []).map(it => ({
      productId: String(it.sku || it.articleNumber || it.id || ''),
      name: String(it.productTitle || it.title || it.sku || 'Otto Artikel'),
      quantity: Number(it.quantity || 1),
      price: Number(it.price || it.salesPrice || 0),
      size: String(it.variation || it.size || ''),
    }));
    const addr = o.shippingAddress || o.deliveryAddress || o.address || {};
    return {
      id: `OTTO-${id}`,
      marketplace: 'otto',
      marketplaceOrderId: id,
      customer: {
        name: String(addr.name || o.customerName || 'Otto Kunde'),
        email: String(addr.email || o.email || ''),
        street: String(addr.street || ''),
        zip: String(addr.zipCode || addr.zip || ''),
        city: String(addr.city || ''),
      },
      items: items.length ? items : [{ productId: 'unknown', name: 'Otto Order ' + id, quantity: 1, price: Number(o.totalPrice || 0) }],
      total: Number(o.totalPrice || o.price || items.reduce((s, it) => s + it.price * it.quantity, 0)),
      status: 'open',
      raw: o,
    };
  }

  async pushTracking(orderId, tracking) {
    const t = String(tracking.trackingNumber || tracking.number || '').trim();
    const carrier = String(tracking.carrier || 'DHL').trim();
    if (this.isDryRun()) return { ok: true, dryRun: true, channel: 'otto', orderId, payload: { trackingNumber: t, carrier }, log: this.logDryRun('pushTracking', { orderId, trackingNumber: t, carrier }) };
    const headers = await this.authHeaders();
    // Otto: POST /shipments oder /orders/{id}/shipments
    try {
      await this.request('POST', `/shipments`, { orderId, trackingNumber: t, carrier }, { headers });
    } catch (e) {
      await this.request('POST', `/orders/${encodeURIComponent(orderId)}/shipments`, { trackingNumber: t, carrierCode: carrier }, { headers });
    }
    return { ok: true, channel: 'otto', orderId, trackingNumber: t };
  }
}

module.exports = { OttoAdapter };
