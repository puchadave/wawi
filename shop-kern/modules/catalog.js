'use strict';
/**
 * WaWi Catalog & Whitelist Manager
 * Verwaltet Produkte, Varianten, Bestände und Whitelist-Status.
 * Integriert mit Debug- & Audit-Logging.
 */

const fs = require('fs');
const { calculateProductPrice } = require('./pricing');
const { logger } = require('./logger');

class CatalogManager {
  constructor(productsFilePath, configFilePath) {
    this.productsFilePath = productsFilePath;
    this.configFilePath = configFilePath;
  }

  loadProducts() {
    try {
      if (!fs.existsSync(this.productsFilePath)) {
        return [];
      }
      const raw = fs.readFileSync(this.productsFilePath, 'utf8');
      const data = JSON.parse(raw);
      return Array.isArray(data.products) ? data.products : (Array.isArray(data) ? data : []);
    } catch (err) {
      logger.error('CATALOG', `Fehler beim Laden von ${this.productsFilePath}: ${err.message}`);
      return [];
    }
  }

  saveProducts(products) {
    const tmp = this.productsFilePath + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ products }, null, 2), 'utf8');
    fs.renameSync(tmp, this.productsFilePath);
    logger.debug('CATALOG', `Produktdatenbank atomar aktualisiert (${products.length} Artikel)`);
  }

  getAll(filter = {}) {
    let list = this.loadProducts();

    if (filter.activeOnly) {
      list = list.filter(p => p.active !== false);
    }
    if (filter.whitelistedOnly) {
      list = list.filter(p => p.isWhitelisted);
    }
    if (filter.category) {
      list = list.filter(p => p.category && p.category.toLowerCase() === filter.category.toLowerCase());
    }
    if (filter.search) {
      const q = filter.search.toLowerCase();
      list = list.filter(p =>
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.sku && p.sku.toLowerCase().includes(q)) ||
        (p.brand && p.brand.toLowerCase().includes(q)) ||
        (p.description && p.description.toLowerCase().includes(q))
      );
    }
    return list;
  }

  getById(id) {
    const list = this.loadProducts();
    return list.find(p => p.id === id || p.sku === id) || null;
  }

  upsertProduct(productData) {
    const list = this.loadProducts();
    const idx = list.findIndex(p => p.id === productData.id || (productData.sku && p.sku === productData.sku));

    const now = new Date().toISOString();
    let product;

    if (idx >= 0) {
      product = {
        ...list[idx],
        ...productData,
        updatedAt: now,
      };
      list[idx] = product;
      logger.audit('CATALOG', `Produkt aktualisiert: ${product.id} (${product.name})`, { id: product.id });
    } else {
      product = {
        id: productData.id || 'p_' + Date.now(),
        sku: productData.sku || ('SKU-' + Date.now().toString(36).toUpperCase()),
        name: productData.name || 'Neuer Artikel',
        brand: productData.brand || '',
        category: productData.category || 'Allgemein',
        categoryPath: productData.categoryPath || '/',
        price: typeof productData.price === 'number' ? productData.price : 0,
        supplierEkNet: productData.supplierEkNet || 0,
        sizes: Array.isArray(productData.sizes) ? productData.sizes : ['Standard'],
        variants: Array.isArray(productData.variants) ? productData.variants : [],
        stock: typeof productData.stock === 'number' ? productData.stock : 0,
        description: productData.description || '',
        image: productData.image || '',
        images: Array.isArray(productData.images) ? productData.images : [],
        active: productData.active !== undefined ? Boolean(productData.active) : true,
        isWhitelisted: Boolean(productData.isWhitelisted),
        status: productData.status || 'imported',
        created: productData.created || now,
        updatedAt: now,
      };
      list.push(product);
      logger.audit('CATALOG', `Neues Produkt angelegt: ${product.id} (${product.name})`, { id: product.id });
    }

    this.saveProducts(list);
    return product;
  }

  setWhitelist(productId, isWhitelisted) {
    const list = this.loadProducts();
    const p = list.find(item => item.id === productId);
    if (!p) {
      logger.warn('CATALOG', `Whitelist-Änderung fehlgeschlagen: Produkt ${productId} nicht gefunden`);
      return null;
    }
    p.isWhitelisted = Boolean(isWhitelisted);
    p.status = isWhitelisted ? 'approved' : 'rejected';
    p.active = p.isWhitelisted;
    p.updatedAt = new Date().toISOString();
    this.saveProducts(list);
    logger.audit('CATALOG', `Whitelist Status für ${productId} geändert: ${isWhitelisted ? 'FREIGESCHALTET' : 'GESPERRT'}`, {
      productId,
      isWhitelisted,
    });
    return p;
  }

  adjustStock(productId, size, delta) {
    const list = this.loadProducts();
    const p = list.find(item => item.id === productId);
    if (!p) {
      logger.warn('CATALOG', `Bestandsänderung fehlgeschlagen: Produkt ${productId} nicht gefunden`);
      return false;
    }

    const oldStock = p.stock || 0;
    p.stock = Math.max(0, oldStock + delta);

    if (Array.isArray(p.variants) && size) {
      const v = p.variants.find(item => item.name.toLowerCase() === size.toLowerCase() || item.id === size);
      if (v) {
        v.stock = Math.max(0, (v.stock || 0) + delta);
      }
    }

    p.updatedAt = new Date().toISOString();
    this.saveProducts(list);
    logger.audit('INVENTORY', `Bestandsänderung ${productId} (${p.name}): ${oldStock} -> ${p.stock} (Delta: ${delta})`, {
      productId,
      size,
      oldStock,
      newStock: p.stock,
      delta,
    });
    return true;
  }

  applyPricingRule(rule, productId = null) {
    const list = this.loadProducts();
    let updatedCount = 0;

    for (const p of list) {
      if (productId && p.id !== productId) continue;
      if (!p.supplierEkNet || p.supplierEkNet <= 0) continue;

      const calc = calculateProductPrice({
        supplierNet: p.supplierEkNet,
        priceRule: rule,
      });

      p.price = calc.shopVkGross;
      p.pricingDetails = calc;
      p.updatedAt = new Date().toISOString();
      updatedCount++;
    }

    if (updatedCount > 0) {
      this.saveProducts(list);
      logger.audit('PRICING', `Preisregel angewendet auf ${updatedCount} Produkte`, { rule });
    }
    return { updatedCount };
  }
}

module.exports = { CatalogManager };
