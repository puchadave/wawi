'use strict';
/**
 * WaWi Mapper — zentrale Abbildung aller WaWi-Informationen auf Shop-/Marktplatz-Strukturen
 * Reibungslose Uebertragung + korrekte Darstellung mit allen Optionen.
 *
 * Quellen:
 *  - MatterhornProduct (xmlparser.js) -> WaWiProduct (catalog.js)
 *  - WaWiProduct -> Shopware 6, eBay, Kleinanzeigen, Kaufland, Otto, Google, Facebook, Telegram
 *
 * Keine externen Dependencies. Kontinuierliches Debugging via logger.
 */

const { logger } = require('./logger');

/**
 * Normalisiert ein Matterhorn-Rohprodukt auf das WaWi-Produkt-Schema.
 * Bewahrt ALLE verfuegbaren Informationen inkl. Varianten/Optionen.
 * @param {object} mh - MatterhornProduct aus xmlparser
 * @param {object} opts - { forceWhitelist:boolean, existing:object|null }
 */
function normalizeMatterhornToWaWi(mh, opts = {}) {
  const t = Date.now();
  const id = String(mh.id || '').trim();
  if (!id) throw new Error('Matterhorn-Produkt ohne id');

  const ekNet = mh.prices && typeof mh.prices.EUR === 'number' ? mh.prices.EUR : 0;
  const category = mh.categoryPath ? (mh.categoryPath.split('/').filter(Boolean)[1] || mh.categoryPath.split('/').filter(Boolean)[0] || 'Import') : 'Import';
  const sizes = (mh.options || []).map(o => o.name).filter(Boolean);
  const variants = (mh.options || []).map(o => ({
    id: String(o.id || ''),
    sku: String(o.id ? `MH-${id}-${o.id}` : `MH-${id}`),
    name: o.name || 'Standard',
    stock: Number(o.stock || 0),
    availableIn: Number(o.availableIn || 0),
    ean: String(o.ean || ''),
    // pro Variante EAN als GTIN, supplier-Anbindung
    supplierVariantId: String(o.id || ''),
  }));
  const totalStock = variants.reduce((s, v) => s + (v.stock || 0), 0);

  // Vollstaendiges WaWi-Produkt — alle Infos, kein Feldverlust
  const waWi = {
    id,
    sku: `MH-${id}`,
    supplierProductId: id,
    name: (mh.name || 'Unbekanntes Produkt').trim(),
    brand: (mh.brand || '').trim(),
    category,
    categoryId: String(mh.categoryId || '0'),
    categoryPath: String(mh.categoryPath || '/'),
    color: String(mh.color || ''),
    type: String(mh.type || ''),
    description: String(mh.descriptionHtml || ''),
    descriptionHtml: String(mh.descriptionHtml || ''),
    price: ekNet > 0 ? Math.round(ekNet * 1.6 * 1.19 * 100) / 100 : 0, // Fallback bis Pricing-Regel appliziert wird
    supplierEkNet: ekNet,
    prices: { ...(mh.prices || {}) },
    sizes: sizes.length ? sizes : ['Standard'],
    variants,
    stock: totalStock,
    image: mh.images && mh.images[0] ? String(mh.images[0]) : '',
    images: Array.isArray(mh.images) ? mh.images.map(String) : [],
    // Matterhorn-Rohdaten bewahren fuer Audits & Re-Mapping
    matterhornData: {
      id: mh.id,
      name: mh.name,
      brand: mh.brand,
      categoryPath: mh.categoryPath,
      categoryId: mh.categoryId,
      color: mh.color,
      type: mh.type,
      descriptionHtml: mh.descriptionHtml,
      images: mh.images || [],
      prices: mh.prices || {},
      options: mh.options || [],
    },
    active: Boolean(opts.forceWhitelist),
    isWhitelisted: Boolean(opts.forceWhitelist),
    status: opts.forceWhitelist ? 'approved' : 'imported',
  };

  logger.debug('MAPPER', `Matterhorn ${id} -> WaWi normalisiert`, { id, variants: variants.length, stock: totalStock, tMs: Date.now() - t });
  return waWi;
}

/** Hilfen */
function escapeXml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
function stripHtml(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
function firstN(s, n) { const x = String(s || ''); return x.length > n ? x.slice(0, n - 1) + '…' : x; }
function resolveChannelPrice(product, channel) {
  if (product.channelPrices && product.channelPrices[channel] != null) return Number(product.channelPrices[channel]);
  if (product.pricingDetailsByPlatform && product.pricingDetailsByPlatform[channel] && product.pricingDetailsByPlatform[channel].shopVkGross != null) return Number(product.pricingDetailsByPlatform[channel].shopVkGross);
  return Number(product.price || 0);
}
function buildCategoryPathForShop(product) {
  // Shopware Kategorie-Pfad sauber splitten
  const raw = product.categoryPath || product.category || 'Import';
  return raw.split('/').map(s => s.trim()).filter(Boolean);
}

/**
 * WaWi -> Shopware 6 Payload (kompatibel zu apps/api/src/shopware/sync.ts Erwartung)
 */
function mapWaWiToShopware(product, cfg = {}) {
  const price = Number(product.price || 0);
  const taxId = cfg.taxId || '01900000000000000000000000000001';
  const currencyId = cfg.currencyId || 'b7d2554b0ce847cd82f3ac9bd1c0dfca';
  const description = product.descriptionHtml || product.description || '';
  const name = product.name || product.sku || product.id;

  // Shopware braucht productNumber = sku, stock, active, tax, price
  const payload = {
    id: product.id, // WaWi fuehrt supplierProductId; Sync erzeugt deterministische Shopware-UUID via uuidv5
    productNumber: product.sku,
    name,
    description,
    metaTitle: firstN(stripHtml(name), 60),
    metaDescription: firstN(stripHtml(description), 160),
    stock: Number(product.stock || 0),
    availableStock: Number(product.stock || 0),
    isCloseout: false,
    active: Boolean(product.active && product.isWhitelisted !== false),
    taxId,
    currencyId,
    price: [{ currencyId, gross: price, net: Number((price / 1.19).toFixed(2)), linked: true }],
    categories: buildCategoryPathForShop(product),
    // Custom fields fuer Matterhorn-Rueckverfolgung
    customFields: {
      matterhorn_product_id: product.supplierProductId || product.id,
      matterhorn_brand: product.brand || '',
      matterhorn_category_path: product.categoryPath || '',
      matterhorn_color: product.color || '',
      matterhorn_type: product.type || '',
      matterhorn_images: product.images || [],
      matterhorn_category_id: product.categoryId || '',
      wawi_status: product.status || 'imported',
    },
    // Media
    media: (product.images || []).map((url, idx) => ({ url, position: idx })),
    coverMediaUrl: product.image || (product.images && product.images[0]) || '',
    // Properties
    properties: {
      brand: product.brand || '',
      color: product.color || '',
      type: product.type || '',
    },
    // Varianten / Konfigurator — jede Matterhorn-Option als Variante
    variants: (product.variants || []).map(v => ({
      id: v.id,
      productNumber: v.sku,
      ean: v.ean || '',
      stock: Number(v.stock || 0),
      availableIn: Number(v.availableIn || 0),
      options: { size: v.name },
      matterhorn_variant_id: v.supplierVariantId || v.id,
      matterhorn_available_in: v.availableIn || 0,
      price, // Varianten erben Kanalpreis; Shopware kann Variantenpreise ueberschreiben
    })),
    brand: product.brand || '',
  };

  logger.debug('MAPPER', `WaWi ${product.id} -> Shopware gemappt`, { variants: payload.variants.length });
  return payload;
}

/**
 * WaWi -> Google Shopping / Meta Feed Item (kompatibel zu channels.js generateGoogleShoppingXml)
 */
function mapWaWiToGoogleShopping(product, baseUrl = 'http://localhost:8080') {
  const price = resolveChannelPrice(product, 'google');
  const desc = stripHtml(product.descriptionHtml || product.description || '');
  return {
    id: product.sku || product.id,
    title: firstN(product.name, 150),
    description: firstN(desc, 5000),
    link: `${baseUrl.replace(/\/$/, '')}/product/${encodeURIComponent(product.id)}`,
    image_link: product.image || (product.images && product.images[0]) || `${baseUrl}/placeholder.png`,
    additional_image_link: (product.images || []).slice(1, 10),
    availability: (product.stock > 0) ? 'in_stock' : 'out_of_stock',
    price: `${price.toFixed(2)} EUR`,
    brand: product.brand || 'Uptempo',
    gtin: (product.variants && product.variants[0] && product.variants[0].ean) ? product.variants[0].ean : '',
    mpn: product.sku || product.id,
    condition: 'new',
    google_product_category: product.categoryPath || product.category || 'Apparel & Accessories',
    custom_label_0: product.color || '',
    custom_label_1: product.type || '',
    item_group_id: product.supplierProductId || product.id,
    variants: (product.variants || []).map(v => ({
      item_group_id: product.supplierProductId || product.id,
      id: v.sku,
      size: v.name,
      availability: v.stock > 0 ? 'in_stock' : 'out_of_stock',
      price: `${price.toFixed(2)} EUR`,
      gtin: v.ean || '',
    })),
  };
}

/**
 * WaWi -> eBay Listing (Inventory API / Trading API kompatibel, Stub fuer direkten Sync)
 */
function mapWaWiToEbay(product) {
  const price = resolveChannelPrice(product, 'ebay');
  const descHtml = product.descriptionHtml || `<p>${escapeXml(product.description || '')}</p>`;
  return {
    sku: product.sku,
    locale: 'de_DE',
    listing: {
      title: firstN(`${product.name} - ${product.brand || ''} - ${product.color || ''}`.replace(/\s+/g,' ').trim(), 140),
      description: descHtml,
      categoryPath: product.categoryPath || product.category || 'Import',
      brand: product.brand || 'Unbekannt',
      mpn: product.sku,
      ean: (product.variants && product.variants[0] && product.variants[0].ean) || undefined,
      condition: 'NEW',
      images: product.images || (product.image ? [product.image] : []),
      price: { value: price.toFixed(2), currency: 'EUR' },
      quantity: Number(product.stock || 0),
      format: 'FIXED_PRICE',
      variants: (product.variants || []).map(v => ({
        sku: v.sku,
        ean: v.ean || undefined,
        size: v.name,
        quantity: Number(v.stock || 0),
        price: { value: price.toFixed(2), currency: 'EUR' },
      })),
      // eBay specifics
      conditionDescription: 'Neu mit Etikett',
      lotSize: 1,
      availableIn: (product.variants && product.variants[0] && product.variants[0].availableIn) || undefined,
    },
    // fuer Inventory API
    inventory: {
      sku: product.sku,
      product: {
        title: firstN(product.name, 140),
        description: stripHtml(descHtml).slice(0, 4000),
        aspects: {
          Brand: [product.brand || 'Uptempo'],
          Type: [product.type || product.category || 'Fashion'],
          Farbe: product.color ? [product.color] : undefined,
        },
        imageUrls: product.images || [],
      },
      offers: [{
        sku: product.sku,
        marketplaceId: 'EBAY_DE',
        format: 'FIXED_PRICE',
        pricingSummary: { price: { value: price.toFixed(2), currency: 'EUR' } },
        quantity: Number(product.stock || 0),
      }],
    },
  };
}

function mapWaWiToKleinanzeigen(product) {
  const price = resolveChannelPrice(product, 'kleinanzeigen');
  const cfgPrice = Number(price || 0).toFixed(2);
  const title = firstN(`NEU: ${product.name} [${(product.variants||[]).map(v=>v.name).join('/').slice(0,40)}]`, 65);
  const body = [
    `Artikel: ${product.name}`,
    `Marke: ${product.brand || '-'}`,
    `Kategorie: ${product.categoryPath || product.category || '-'}`,
    `Farbe: ${product.color || '-'}`,
    `Typ: ${product.type || '-'}`,
    `Zustand: NEU mit Etikett`,
    ``,
    `BESCHREIBUNG:`,
    stripHtml(product.descriptionHtml || product.description || 'Hochwertige Qualitaet.').slice(0, 2000),
    ``,
    `DETAILS & GROESSEN:`,
    `• Groessen: ${(product.sizes || []).join(', ') || (product.variants||[]).map(v=>`${v.name} (${v.stock}x)`).join(', ')}`,
    `• Varianten: ${(product.variants||[]).map(v=>`${v.name}: EAN ${v.ean||'-'} Lager ${v.stock}`).join(' | ')}`,
    `• Gesamtbestand: ${product.stock} Stueck`,
    ``,
    `VERSAND & ZAHLUNG:`,
    `• Versicherter DHL-Versand inkl. Tracking am selben Werktag`,
    `• PayPal Kaeuferschutz / Ueberweisung`,
  ].join('\n');
  return { title, price: cfgPrice, body, images: product.images || [], variants: product.variants || [], category: product.categoryPath || product.category };
}

function mapWaWiToKaufland(product) {
  const price = resolveChannelPrice(product, 'kaufland');
  return {
    sku: product.sku,
    title: firstN(product.name, 150),
    description: stripHtml(product.descriptionHtml || product.description || '').slice(0, 4000),
    categoryPath: product.categoryPath || product.category,
    brand: product.brand || '',
    ean: (product.variants && product.variants[0] && product.variants[0].ean) || '',
    images: product.images || [],
    price: Number(price.toFixed(2)),
    currency: 'EUR',
    quantity: Number(product.stock || 0),
    variants: (product.variants || []).map(v => ({
      sku: v.sku, ean: v.ean || '', size: v.name, quantity: Number(v.stock||0), price: Number(price.toFixed(2)),
    })),
    condition: 'new',
    deliveryTime: (product.variants && product.variants[0] && product.variants[0].availableIn) ? `${product.variants[0].availableIn} days` : undefined,
  };
}

function mapWaWiToOtto(product) {
  const price = resolveChannelPrice(product, 'otto');
  return {
    sku: product.sku,
    title: firstN(product.name, 150),
    longDescription: product.descriptionHtml || `<p>${escapeXml(product.description||'')}</p>`,
    brand: product.brand || 'Uptempo',
    categoryPath: product.categoryPath || product.category,
    color: product.color || '',
    type: product.type || '',
    images: product.images || [],
    price: Number(price.toFixed(2)),
    currency: 'EUR',
    quantity: Number(product.stock || 0),
    ean: (product.variants && product.variants[0] && product.variants[0].ean) || undefined,
    variants: (product.variants || []).map(v => ({
      sku: v.sku, ean: v.ean || '', size: v.name, stock: Number(v.stock||0), price: Number(price.toFixed(2)),
    })),
  };
}

function mapWaWiToFacebook(product) {
  const price = resolveChannelPrice(product, 'facebook');
  // kompatibel zu ChannelsManager.generateFacebookListing Erwartung
  return {
    title: firstN(product.name, 100),
    price: Number(price.toFixed(2)),
    description: stripHtml(product.descriptionHtml || product.description || '').slice(0, 2000),
    images: product.images || [],
    variants: product.variants || [],
    category: product.categoryPath || product.category,
    brand: product.brand || '',
  };
}

/**
 * Dispatcher: WaWi -> beliebiger Channel
 */
function mapWaWiToChannel(product, channel, opts = {}) {
  const ch = String(channel || 'shop').toLowerCase();
  const baseUrl = opts.baseUrl || 'http://localhost:8080';
  const cfg = opts.shopwareCfg || {};
  switch (ch) {
    case 'shop':
    case 'shopware':
      return mapWaWiToShopware(product, cfg);
    case 'google':
    case 'google-shopping':
    case 'meta':
      return mapWaWiToGoogleShopping(product, baseUrl);
    case 'ebay':
      return mapWaWiToEbay(product);
    case 'kleinanzeigen':
    case 'ebay-kleinanzeigen':
      return mapWaWiToKleinanzeigen(product);
    case 'kaufland':
      return mapWaWiToKaufland(product);
    case 'otto':
      return mapWaWiToOtto(product);
    case 'facebook':
      return mapWaWiToFacebook(product);
    case 'telegram':
      return { text: `${product.name} — ${resolveChannelPrice(product, 'telegram').toFixed(2)} EUR — ${product.stock}x` };
    default:
      logger.warn('MAPPER', `Unbekannter Channel ${ch}, fallback auf Shopware`);
      return mapWaWiToShopware(product, cfg);
  }
}

module.exports = {
  normalizeMatterhornToWaWi,
  mapWaWiToShopware,
  mapWaWiToGoogleShopping,
  mapWaWiToEbay,
  mapWaWiToKleinanzeigen,
  mapWaWiToKaufland,
  mapWaWiToOtto,
  mapWaWiToFacebook,
  mapWaWiToChannel,
  resolveChannelPrice,
  stripHtml,
  escapeXml,
};
