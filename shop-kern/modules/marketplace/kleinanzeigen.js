'use strict';
/**
 * Kleinanzeigen Adapter — Export/Bridge (keine stabile offizielle Seller-API)
 * Liefert Listing-Payloads via mapper, DryRun default, optional Bridge-Publish
 */

const { MarketplaceBase } = require('./base');
const { logger } = require('../logger');

class KleinanzeigenAdapter extends MarketplaceBase {
  constructor(catalogManager, getConfig, orderManager) {
    super('kleinanzeigen', catalogManager, getConfig, orderManager);
  }

  async healthCheck() {
    const base = await super.healthCheck();
    const cfg = this.getChannelConfig();
    if (cfg.bridgeUrl) {
      try {
        await this.request('GET', '/health', null, { baseUrl: cfg.bridgeUrl });
        return { ...base, ok: true, message: 'Kleinanzeigen Bridge erreichbar', bridgeUrl: cfg.bridgeUrl };
      } catch (err) {
        return { ...base, ok: false, message: `Bridge Health failed: ${err.message}`, bridgeUrl: cfg.bridgeUrl };
      }
    }
    return { ...base, ok: true, message: 'Kleinanzeigen Export bereit (keine API — Export/Bridge-Modus)', hint: 'Setze marketplace.kleinanzeigen.bridgeUrl fuer automatisches Publish via Headless-Worker, sonst Export nutzen' };
  }

  generatePayload(productId) {
    const product = this.catalogManager.getById(productId);
    if (!product) throw new Error(`Produkt ${productId} nicht gefunden`);
    const { mapWaWiToKleinanzeigen } = require('../mapper');
    return mapWaWiToKleinanzeigen(product);
  }

  async pushProduct(productId) {
    const payload = this.generatePayload(productId);
    const cfg = this.getChannelConfig();
    if (this.isDryRun() && !cfg.bridgeUrl) {
      return { ok: true, dryRun: true, channel: 'kleinanzeigen', productId, payload, hint: 'Kein Bridge konfiguriert — Payload via /api/admin/channels/kleinanzeigen/:id oder /api/admin/channels/export/kleinanzeigen exportieren', log: this.logDryRun('pushProduct', { productId, title: payload.title }) };
    }
    if (cfg.bridgeUrl) {
      // Bridge erwartet { title, price, body, images, ... }
      const res = await this.request('POST', '/publish', payload, { baseUrl: cfg.bridgeUrl });
      logger.audit('MARKETPLACE', `Kleinanzeigen Bridge push ${productId}`, { channel: 'kleinanzeigen' });
      return { ok: true, channel: 'kleinanzeigen', productId, response: res.body, dryRun: this.isDryRun() };
    }
    return { ok: true, dryRun: true, channel: 'kleinanzeigen', productId, payload, log: this.logDryRun('pushProduct', payload) };
  }

  async pushStock(productId) {
    // Kleinanzeigen hat keinen Stock-Sync — nur Neu-Publish bei Verfuegbarkeit
    const product = this.catalogManager.getById(productId);
    if (!product) throw new Error(`Produkt ${productId} nicht gefunden`);
    const payload = { productId, stock: Number(product.stock || 0), available: (product.stock || 0) > 0 };
    if (this.isDryRun()) return { ok: true, dryRun: true, channel: 'kleinanzeigen', productId, payload, log: this.logDryRun('pushStock', payload) };
    // Bridge: informiere ueber Stock-Aenderung (Bridge kann delisten)
    const cfg = this.getChannelConfig();
    if (cfg.bridgeUrl) {
      await this.request('POST', '/stock', payload, { baseUrl: cfg.bridgeUrl });
    }
    return { ok: true, channel: 'kleinanzeigen', productId, stock: payload.stock };
  }

  async pushPrice(productId) {
    const product = this.catalogManager.getById(productId);
    if (!product) throw new Error(`Produkt ${productId} nicht gefunden`);
    const { resolveChannelPrice } = require('../mapper');
    const price = Number(resolveChannelPrice(product, 'kleinanzeigen') || product.price || 0);
    const payload = { productId, price };
    if (this.isDryRun()) return { ok: true, dryRun: true, channel: 'kleinanzeigen', productId, payload, log: this.logDryRun('pushPrice', payload) };
    const cfg = this.getChannelConfig();
    if (cfg.bridgeUrl) {
      await this.request('POST', '/price', payload, { baseUrl: cfg.bridgeUrl });
    }
    return { ok: true, channel: 'kleinanzeigen', productId, price };
  }

  async importOrders(_since) {
    // Kleinanzeigen hat keinen Order-Feed — manuell via Chat/Anfrage
    const entry = this.logDryRun('importOrders', { note: 'Kleinanzeigen hat keinen automatischen Order-Import — Nachrichten manuell in WaWi anlegen' });
    return { ok: true, dryRun: true, imported: 0, orders: [], hint: 'Kleinanzeigen Bestellungen manuell via /api/admin/orders anlegen', log: entry };
  }

  async pushTracking(orderId, tracking) {
    const t = String(tracking.trackingNumber || tracking.number || '').trim();
    const carrier = String(tracking.carrier || 'DHL').trim();
    // Nur Log + ggf. Bridge informieren
    const cfg = this.getChannelConfig();
    if (cfg.bridgeUrl && !this.isDryRun()) {
      try { await this.request('POST', '/tracking', { orderId, trackingNumber: t, carrier }, { baseUrl: cfg.bridgeUrl }); } catch (e) { logger.warn('MARKETPLACE', `Kleinanzeigen tracking bridge failed: ${e.message}`); }
    }
    return { ok: true, dryRun: this.isDryRun(), channel: 'kleinanzeigen', orderId, trackingNumber: t, log: this.logDryRun('pushTracking', { orderId, trackingNumber: t, carrier }) };
  }

  async exportBatch(limit = 100) {
    const list = this.catalogManager.loadProducts().filter(p => p.isWhitelisted || p.active).slice(0, limit);
    const { mapWaWiToKleinanzeigen } = require('../mapper');
    return list.map(p => ({ id: p.id, sku: p.sku, payload: mapWaWiToKleinanzeigen(p) }));
  }
}

module.exports = { KleinanzeigenAdapter };
