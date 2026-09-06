'use strict';
/**
 * eBay Sell API Adapter (Inventory + Fulfillment)
 * Auth: OAuth2 (clientId/secret + refreshToken), DryRun default
 */

const { MarketplaceBase } = require('./base');
const { logger } = require('../logger');

class EbayAdapter extends MarketplaceBase {
  constructor(catalogManager, getConfig, orderManager) {
    super('ebay', catalogManager, getConfig, orderManager);
    this.tokenCache = null;
  }

  async getAccessToken() {
    const cfg = this.getChannelConfig();
    if (!cfg.clientId || !cfg.clientSecret) throw new Error('eBay clientId/secret fehlt');
    // Wenn refreshToken vorhanden: Token via eBay OAuth
    if (cfg.refreshToken) {
      if (this.tokenCache && this.tokenCache.expMs > Date.now() + 60000) return this.tokenCache.token;
      const body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(cfg.refreshToken)}&scope=${encodeURIComponent('https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.fulfillment')}`;
      const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
      const res = await this.request('POST', 'https://api.ebay.com/identity/v1/oauth/token', body, {
        baseUrl: '',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${basic}` },
      });
      const token = res.body && res.body.access_token;
      const expiresIn = (res.body && res.body.expires_in) || 7200;
      if (!token) throw new Error('eBay token ohne access_token');
      this.tokenCache = { token, expMs: Date.now() + Number(expiresIn) * 1000 };
      return token;
    }
    // Fallback: Client Credentials (Inventory only, ohne User-Kontext eingeschraenkt)
    throw new Error('eBay refreshToken fehlt — OAuth User-Token erforderlich (Kunden-Autorisierung)');
  }

  async authHeaders() {
    const token = await this.getAccessToken();
    return { 'Authorization': `Bearer ${token}` };
  }

  async ensureInventoryLocation(headers) {
    // eBay verlangt Merchant Location fuer Inventory
    const locId = 'wawi_main';
    try {
      await this.request('GET', `/sell/inventory/v1/location/${encodeURIComponent(locId)}`, null, { headers });
      return locId;
    } catch (e) {
      if (e.statusCode !== 404) throw e;
      await this.request('POST', `/sell/inventory/v1/location/${encodeURIComponent(locId)}`, {
        location: { address: { addressLine1: 'WaWi', city: 'Berlin', country: 'DE', postalCode: '10115' } },
        locationTypes: ['WAREHOUSE'],
        merchantLocationStatus: 'ENABLED',
        name: 'WaWi Hauptlager',
      }, { headers });
      return locId;
    }
  }

  async healthCheck() {
    const base = await super.healthCheck();
    if (base.dryRun) return { ...base, hint: 'Setze marketplace.ebay {enabled:true, clientId, clientSecret, refreshToken} oder EBAY_* env' };
    try {
      const headers = await this.authHeaders();
      await this.request('GET', '/sell/inventory/v1/inventory_item?limit=1', null, { headers });
      return { ...base, ok: true, message: 'eBay API erreichbar' };
    } catch (err) {
      return { ...base, ok: false, message: `eBay Health failed: ${err.message}`, statusCode: err.statusCode };
    }
  }

  async pushProduct(productId) {
    const product = this.catalogManager.getById(productId);
    if (!product) throw new Error(`Produkt ${productId} nicht gefunden`);
    const { mapWaWiToEbay } = require('../mapper');
    const mapped = mapWaWiToEbay(product);
    if (this.isDryRun()) {
      return { ok: true, dryRun: true, channel: 'ebay', productId, payload: mapped, log: this.logDryRun('pushProduct', { sku: mapped.sku, title: mapped.listing.title }) };
    }
    const headers = await this.authHeaders();
    const locId = await this.ensureInventoryLocation(headers);
    // 1. Inventory Item upsert
    await this.request('PUT', `/sell/inventory/v1/inventory_item/${encodeURIComponent(mapped.sku)}`, {
      sku: mapped.sku,
      product: { title: mapped.inventory.product.title, description: mapped.inventory.product.description, aspects: mapped.inventory.product.aspects, imageUrls: mapped.inventory.product.imageUrls },
      availability: { shipToLocationAvailability: { quantity: Number(product.stock || 0) } },
      condition: 'NEW',
    }, { headers });
    // 2. Offer create/update
    const offerPayload = {
      sku: mapped.sku,
      marketplaceId: 'EBAY_DE',
      format: 'FIXED_PRICE',
      listingDescription: mapped.listing.description,
      availableQuantity: Number(product.stock || 0),
      pricingSummary: mapped.listing.price ? { price: mapped.listing.price } : { price: { value: String(product.price || 0), currency: 'EUR' } },
      listingPolicies: { fulfillmentPolicyId: undefined, paymentPolicyId: undefined, returnPolicyId: undefined },
      merchantLocationKey: locId,
      categoryId: mapped.listing.categoryPath, // eBay verlangt categoryId numerisch — ggf. Mapping noetig, hier als Fallback
    };
    let offerId;
    try {
      const res = await this.request('POST', '/sell/inventory/v1/offer', offerPayload, { headers });
      offerId = res.body && (res.body.offerId || res.body.offer_id);
    } catch (e) {
      // Offer existiert ggf. bereits — Update versuchen
      logger.warn('MARKETPLACE', `eBay offer create failed, versuche update: ${e.message}`, { channel: 'ebay' });
      const listRes = await this.request('GET', `/sell/inventory/v1/offer?sku=${encodeURIComponent(mapped.sku)}`, null, { headers });
      const offers = listRes.body && (listRes.body.offers || []);
      if (offers.length) {
        offerId = offers[0].offerId;
        await this.request('PUT', `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`, offerPayload, { headers });
      }
    }
    if (offerId) {
      try { await this.request('POST', `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`, {}, { headers }); } catch (e) { logger.warn('MARKETPLACE', `eBay publish ${offerId} failed: ${e.message}`); }
    }
    logger.audit('MARKETPLACE', `eBay pushProduct ${productId} -> ${mapped.sku} offer ${offerId || '-'}`, { channel: 'ebay' });
    return { ok: true, channel: 'ebay', productId, sku: mapped.sku, offerId };
  }

  async pushStock(productId) {
    const product = this.catalogManager.getById(productId);
    if (!product) throw new Error(`Produkt ${productId} nicht gefunden`);
    if (this.isDryRun()) return { ok: true, dryRun: true, channel: 'ebay', productId, payload: { quantity: Number(product.stock||0) }, log: this.logDryRun('pushStock', { productId, quantity: product.stock }) };
    const headers = await this.authHeaders();
    const sku = product.sku || `MH-${product.id}`;
    await this.request('PUT', `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}/quantity`, { quantity: Number(product.stock||0) }, { headers });
    return { ok: true, channel: 'ebay', productId, quantity: Number(product.stock||0) };
  }

  async pushPrice(productId) {
    const product = this.catalogManager.getById(productId);
    if (!product) throw new Error(`Produkt ${productId} nicht gefunden`);
    const { resolveChannelPrice } = require('../mapper');
    const price = Number(resolveChannelPrice(product, 'ebay') || product.price || 0);
    if (this.isDryRun()) return { ok: true, dryRun: true, channel: 'ebay', productId, payload: { price }, log: this.logDryRun('pushPrice', { productId, price }) };
    const headers = await this.authHeaders();
    // Preis via Offer Update
    const sku = product.sku || `MH-${product.id}`;
    const listRes = await this.request('GET', `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`, null, { headers });
    const offers = listRes.body && (listRes.body.offers || []);
    if (offers.length) {
      const offerId = offers[0].offerId;
      await this.request('PUT', `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`, { pricingSummary: { price: { value: price.toFixed(2), currency: 'EUR' } } }, { headers });
    }
    return { ok: true, channel: 'ebay', productId, price };
  }

  async importOrders(since) {
    if (this.isDryRun()) {
      const entry = this.logDryRun('importOrders', { since: since || null });
      return { ok: true, dryRun: true, imported: 0, orders: [], log: entry };
    }
    const headers = await this.authHeaders();
    const qs = since ? `?filter=creationdate:[${encodeURIComponent(since)}..]` : '';
    const res = await this.request('GET', `/sell/fulfillment/v1/order${qs}`, null, { headers });
    const rawOrders = (res.body && (res.body.orders || res.body)) || [];
    const list = Array.isArray(rawOrders) ? rawOrders : [];
    let imported = 0;
    for (const o of list) {
      try {
        const mapped = this.mapEbayOrder(o);
        if (this.orderManager) { this.orderManager.createOrder(mapped); imported++; }
      } catch (e) { logger.warn('MARKETPLACE', `eBay order map failed: ${e.message}`); }
    }
    logger.info('MARKETPLACE', `eBay importOrders: ${imported}/${list.length}`, { channel: 'ebay' });
    return { ok: true, imported, total: list.length, orders: list.slice(0, 20) };
  }

  mapEbayOrder(o) {
    const id = String(o.orderId || o.legacyOrderId || `EBAY-${Date.now()}`);
    const items = (o.lineItems || []).map(it => ({
      productId: String(it.sku || it.legacyItemId || ''),
      name: String(it.title || it.sku || 'eBay Artikel'),
      quantity: Number(it.quantity || 1),
      price: Number((it.lineItemCost && it.lineItemCost.value) || it.price || 0),
      size: '',
    }));
    const addr = (o.fulfillmentStartInstructions && o.fulfillmentStartInstructions[0] && o.fulfillmentStartInstructions[0].shippingStep && o.fulfillmentStartInstructions[0].shippingStep.shipTo) || o.buyer || {};
    const shipAddr = addr.contactAddress || addr.shippingAddress || {};
    return {
      id: `EBAY-${id}`,
      marketplace: 'ebay',
      marketplaceOrderId: id,
      customer: {
        name: String(addr.fullName || o.buyerUsername || 'eBay Kunde'),
        email: String(addr.email || o.buyerEmail || ''),
        street: String(shipAddr.addressLine1 || ''),
        zip: String(shipAddr.postalCode || ''),
        city: String(shipAddr.city || ''),
      },
      items: items.length ? items : [{ productId: 'unknown', name: 'eBay Order ' + id, quantity: 1, price: Number((o.pricingSummary && o.pricingSummary.total && o.pricingSummary.total.value) || 0) }],
      total: Number((o.pricingSummary && o.pricingSummary.total && o.pricingSummary.total.value) || items.reduce((s, it) => s + it.price * it.quantity, 0)),
      status: 'open',
      raw: o,
    };
  }

  async pushTracking(orderId, tracking) {
    const t = String(tracking.trackingNumber || tracking.number || '').trim();
    const carrier = String(tracking.carrier || 'DHL').trim();
    if (this.isDryRun()) return { ok: true, dryRun: true, channel: 'ebay', orderId, payload: { trackingNumber: t, carrier }, log: this.logDryRun('pushTracking', { orderId, trackingNumber: t, carrier }) };
    const headers = await this.authHeaders();
    // eBay Fulfillment: POST /sell/fulfillment/v1/order/{orderId}/shipping_fulfillment
    await this.request('POST', `/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}/shipping_fulfillment`, {
      lineItems: [], // alle Items
      shippedDate: new Date().toISOString(),
      shippingCarrierCode: carrier,
      trackingNumber: t,
    }, { headers });
    return { ok: true, channel: 'ebay', orderId, trackingNumber: t };
  }
}

module.exports = { EbayAdapter };
