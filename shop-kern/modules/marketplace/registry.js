'use strict';
/**
 * Marketplace Registry — kanal-uebergreifend
 */

const { KauflandAdapter } = require('./kaufland');
const { OttoAdapter } = require('./otto');
const { EbayAdapter } = require('./ebay');
const { KleinanzeigenAdapter } = require('./kleinanzeigen');
const { logger } = require('../logger');

class MarketplaceRegistry {
  constructor(catalogManager, getConfig, orderManager) {
    this.catalogManager = catalogManager;
    this.getConfig = getConfig;
    this.orderManager = orderManager;
    this.adapters = {
      kaufland: new KauflandAdapter(catalogManager, getConfig, orderManager),
      otto: new OttoAdapter(catalogManager, getConfig, orderManager),
      ebay: new EbayAdapter(catalogManager, getConfig, orderManager),
      kleinanzeigen: new KleinanzeigenAdapter(catalogManager, getConfig, orderManager),
    };
  }

  getAdapter(channel) {
    const ch = String(channel).toLowerCase();
    const a = this.adapters[ch];
    if (!a) throw new Error(`Unbekannter Channel: ${channel} (erlaubt: kaufland, otto, ebay, kleinanzeigen)`);
    return a;
  }

  async getStatus() {
    const out = {};
    for (const [ch, ad] of Object.entries(this.adapters)) {
      try {
        out[ch] = await ad.healthCheck();
      } catch (e) {
        out[ch] = { channel: ch, ok: false, error: e.message };
      }
    }
    logger.debug('MARKETPLACE', 'Registry status abgefragt', { channels: Object.keys(out) });
    return out;
  }

  async pushProduct(channel, productId) {
    const ad = this.getAdapter(channel);
    return ad.pushProduct(productId);
  }

  async pushProducts(channel, productIds) {
    const ad = this.getAdapter(channel);
    const results = [];
    for (const id of productIds) {
      try {
        const r = await ad.pushProduct(String(id));
        results.push({ id, ok: true, ...r });
      } catch (e) {
        logger.warn('MARKETPLACE', `${channel} push ${id} failed: ${e.message}`, { channel, id });
        results.push({ id, ok: false, error: e.message });
      }
    }
    return { channel, count: results.length, results };
  }

  async pushStock(channel, productId) {
    return this.getAdapter(channel).pushStock(productId);
  }

  async pushPrice(channel, productId) {
    return this.getAdapter(channel).pushPrice(productId);
  }

  async importOrders(channel, since) {
    return this.getAdapter(channel).importOrders(since);
  }

  async pushTracking(channel, orderId, tracking) {
    return this.getAdapter(channel).pushTracking(orderId, tracking);
  }

  async syncAll(channels = ['kaufland', 'otto', 'ebay', 'kleinanzeigen'], opts = {}) {
    // opts: { productIds?: string[], importOrders?: boolean, since?: string }
    const res = {};
    for (const ch of channels) {
      const ad = this.getAdapter(ch);
      if (opts.productIds && opts.productIds.length) {
        res[ch] = await this.pushProducts(ch, opts.productIds);
      } else {
        // Export-Modus: alle whitelisted pushen (dryRun loggt nur)
        const list = this.catalogManager.loadProducts().filter(p => p.isWhitelisted || p.active).slice(0, opts.limit || 20);
        const ids = list.map(p => p.id);
        res[ch] = await this.pushProducts(ch, ids);
      }
      if (opts.importOrders) {
        try { res[ch].orders = await ad.importOrders(opts.since); } catch (e) { res[ch].ordersError = e.message; }
      }
    }
    return res;
  }
}

module.exports = { MarketplaceRegistry };
