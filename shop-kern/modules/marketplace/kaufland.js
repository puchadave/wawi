'use strict';
/**
 * Kaufland Marketplace Adapter — Seller API v2
 * Auth: HMAC-SHA256 (apiKey + timestamp + clientKey), DryRun default bis Credentials gesetzt
 * Verwendet mapper.mapWaWiToKaufland() fuer Payload
 */

const { MarketplaceBase } = require('./base');
const { logger } = require('../logger');

function kauflandSign({ method, url, bodyStr, cfg }) {
  // Kaufland Seller API v2: HMAC-SHA256 ueber timestamp + method + path + body
  // Docs: sellerapi.kaufland.com — X-ApiKey, X-Timestamp, X-Signature
  // Vereinfachter Stub mit realer HMAC-Logik (Timestamp + secret)
  const crypto = require('crypto');
  const ts = Math.floor(Date.now() / 1000).toString();
  const u = new URL(url);
  const pathQ = u.pathname + u.search;
  const payload = [ts, method.toUpperCase(), pathQ, bodyStr || ''].join('\n');
  const sig = cfg.secret ? crypto.createHmac('sha256', cfg.secret).update(payload).digest('hex') : '';
  return {
    'X-ApiKey': cfg.apiKey || '',
    'X-Timestamp': ts,
    'X-Signature': sig,
    ...(cfg.clientKey ? { 'X-ClientKey': cfg.clientKey } : {}),
  };
}

class KauflandAdapter extends MarketplaceBase {
  constructor(catalogManager, getConfig, orderManager) {
    super('kaufland', catalogManager, getConfig, orderManager);
  }

  async healthCheck() {
    const base = await super.healthCheck();
    if (base.dryRun) return { ...base, hint: 'Setze marketplace.kaufland {enabled:true, apiKey, secret} in config.json oder KAUFLAND_API_KEY/SECRET env' };
    try {
      // Lightweight: GET /orders?limit=1 als Health-Probe
      await this.request('GET', '/orders?limit=1', null, { sign: kauflandSign });
      return { ...base, ok: true, message: 'Kaufland API erreichbar' };
    } catch (err) {
      return { ...base, ok: false, message: `Kaufland Health failed: ${err.message}`, statusCode: err.statusCode };
    }
  }

  async pushProduct(productId) {
    const product = this.catalogManager.getById(productId);
    if (!product) throw new Error(`Produkt ${productId} nicht gefunden`);
    const { mapWaWiToKaufland } = require('../mapper');
    const mapped = mapWaWiToKaufland(product);
    // Kaufland erwartet Offer-Payload: sku, title, price, quantity, ean, images, category
    const offer = {
      sku: mapped.sku,
      title: mapped.title,
      description: mapped.description,
      price: mapped.price,
      quantity: mapped.quantity,
      ean: mapped.ean || undefined,
      images: mapped.images,
      category_id: mapped.categoryPath, // Kaufland Kategorien via categoryPath, ggf. Mapping noetig
      condition: 'new',
      delivery_time: mapped.deliveryTime || '2-3 days',
      // Varianten als separate Offers (Kaufland: je Variante ein Offer)
      variants: mapped.variants,
    };
    if (this.isDryRun()) {
      return { ok: true, dryRun: true, channel: 'kaufland', productId, payload: offer, log: this.logDryRun('pushProduct', offer) };
    }
    // Upsert: PUT /offers/{sku} (idempotent)
    const res = await this.request('PUT', `/offers/${encodeURIComponent(mapped.sku)}`, offer, { sign: kauflandSign });
    logger.audit('MARKETPLACE', `Kaufland pushProduct ${productId} -> ${mapped.sku}`, { channel: 'kaufland', sku: mapped.sku });
    // Varianten separat
    for (const v of mapped.variants || []) {
      if (!v.sku || v.sku === mapped.sku) continue;
      const vOffer = { ...offer, sku: v.sku, ean: v.ean, quantity: v.quantity, price: v.price };
      try {
        await this.request('PUT', `/offers/${encodeURIComponent(v.sku)}`, vOffer, { sign: kauflandSign });
      } catch (e) {
        logger.warn('MARKETPLACE', `Kaufland Variante ${v.sku} push fehlgeschlagen: ${e.message}`, { channel: 'kaufland' });
      }
    }
    return { ok: true, channel: 'kaufland', productId, sku: mapped.sku, response: res.body };
  }

  async pushStock(productId) {
    const product = this.catalogManager.getById(productId);
    if (!product) throw new Error(`Produkt ${productId} nicht gefunden`);
    const payload = { quantity: Number(product.stock || 0) };
    if (this.isDryRun()) return { ok: true, dryRun: true, channel: 'kaufland', productId, payload, log: this.logDryRun('pushStock', payload) };
    const sku = product.sku || `MH-${product.id}`;
    await this.request('PATCH', `/offers/${encodeURIComponent(sku)}/quantity`, payload, { sign: kauflandSign });
    for (const v of product.variants || []) {
      const vSku = v.sku || `${sku}-${v.id}`;
      try { await this.request('PATCH', `/offers/${encodeURIComponent(vSku)}/quantity`, { quantity: Number(v.stock || 0) }, { sign: kauflandSign }); } catch (e) { logger.warn('MARKETPLACE', `Kaufland stock ${vSku} failed: ${e.message}`); }
    }
    return { ok: true, channel: 'kaufland', productId, quantity: payload.quantity };
  }

  async pushPrice(productId) {
    const product = this.catalogManager.getById(productId);
    if (!product) throw new Error(`Produkt ${productId} nicht gefunden`);
    const { resolveChannelPrice } = require('../mapper');
    const price = Number(resolveChannelPrice(product, 'kaufland') || product.price || 0);
    const payload = { price };
    if (this.isDryRun()) return { ok: true, dryRun: true, channel: 'kaufland', productId, payload, log: this.logDryRun('pushPrice', payload) };
    const sku = product.sku || `MH-${product.id}`;
    await this.request('PATCH', `/offers/${encodeURIComponent(sku)}/price`, { price }, { sign: kauflandSign });
    return { ok: true, channel: 'kaufland', productId, price };
  }

  async importOrders(since) {
    if (this.isDryRun()) {
      const entry = this.logDryRun('importOrders', { since: since || null });
      return { ok: true, dryRun: true, imported: 0, orders: [], log: entry };
    }
    const qs = since ? `?updated_since=${encodeURIComponent(since)}` : '';
    const res = await this.request('GET', `/orders${qs}`, null, { sign: kauflandSign });
    const rawOrders = res.body && (res.body.orders || res.body.data || res.body) || [];
    const list = Array.isArray(rawOrders) ? rawOrders : [];
    let imported = 0;
    for (const o of list) {
      try {
        const mapped = this.mapKauflandOrder(o);
        if (this.orderManager) { this.orderManager.createOrder(mapped); imported++; }
      } catch (e) { logger.warn('MARKETPLACE', `Kaufland order map failed: ${e.message}`); }
    }
    logger.info('MARKETPLACE', `Kaufland importOrders: ${imported}/${list.length}`, { channel: 'kaufland' });
    return { ok: true, imported, total: list.length, orders: list.slice(0, 20) };
  }

  mapKauflandOrder(o) {
    // Kaufland Order -> WaWi OrderManager.createOrder Erwartung: {customer:{name,email,street,zip,city}, items:[{productId,name,quantity,price}], total, marketplace, marketplaceOrderId}
    const id = String(o.id || o.order_id || o.orderId || `KL-${Date.now()}`);
    const items = (o.items || o.order_items || o.positions || []).map(it => ({
      productId: String(it.sku || it.mpn || it.id || ''),
      name: String(it.title || it.name || it.sku || 'Kaufland Artikel'),
      quantity: Number(it.quantity || it.qty || 1),
      price: Number(it.price || it.unit_price || 0),
      size: String(it.size || it.variant || ''),
    }));
    const addr = o.shipping_address || o.address || o.customer || {};
    return {
      id: `KL-${id}`,
      marketplace: 'kaufland',
      marketplaceOrderId: id,
      customer: {
        name: String(addr.name || o.customer_name || o.buyer || 'Kaufland Kunde'),
        email: String(addr.email || o.email || ''),
        street: String(addr.street || addr.street_address || ''),
        zip: String(addr.zip || addr.postcode || ''),
        city: String(addr.city || ''),
      },
      items: items.length ? items : [{ productId: 'unknown', name: 'Kaufland Order ' + id, quantity: 1, price: Number(o.total || 0) }],
      total: Number(o.total || o.price_total || items.reduce((s, it) => s + it.price * it.quantity, 0)),
      status: 'open',
      raw: o,
    };
  }

  async pushTracking(orderId, tracking) {
    const t = String(tracking.trackingNumber || tracking.number || '').trim();
    const carrier = String(tracking.carrier || 'DHL').trim();
    if (this.isDryRun()) return { ok: true, dryRun: true, channel: 'kaufland', orderId, payload: { trackingNumber: t, carrier }, log: this.logDryRun('pushTracking', { orderId, trackingNumber: t, carrier }) };
    // Kaufland: POST /orders/{id}/shipments oder PUT /orders/{id}/status
    try {
      await this.request('POST', `/orders/${encodeURIComponent(orderId)}/shipments`, { tracking_number: t, carrier }, { sign: kauflandSign });
    } catch (e) {
      await this.request('PUT', `/orders/${encodeURIComponent(orderId)}/status`, { status: 'shipped', tracking_number: t }, { sign: kauflandSign });
    }
    return { ok: true, channel: 'kaufland', orderId, trackingNumber: t };
  }
}

module.exports = { KauflandAdapter };
