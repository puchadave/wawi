#!/usr/bin/env node
/**
 * WaWi Shop-Kern v2.3 — Vollständiges Multi-Channel & Produktionssystem
 * 100% Node.js-Stdlib, KEINE externen Pakete, KEIN Docker, KEINE Build-Stufe.
 *
 * Eingebautes kontinuierliches Debugging, Telemetrie, Request-Tracing & Audit-Logging.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { URL } = require('url');

const { logger } = require('./modules/logger');
const { calculateProductPrice } = require('./modules/pricing');
const { parseMatterhornXml } = require('./modules/xmlparser');
const { CatalogManager } = require('./modules/catalog');
const { OrderManager } = require('./modules/orders');
const { ChannelsManager } = require('./modules/channels');
const { MarketplaceRegistry } = require('./modules/marketplace/registry');

const PORT = parseInt(process.argv[2] || process.env.PORT || '8080', 10);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const ADMIN_KEY_FILE = path.join(DATA_DIR, 'admin.key');
const SESSION_FILE = path.join(DATA_DIR, 'sessions.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const HOSTNAME = os.hostname();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.xml': 'application/xml; charset=utf-8',
};

/* ---------- Globale Fehlertoleranz ---------- */

process.on('uncaughtException', (err) => {
  logger.error('CRASH_PREVENT', `Uncaught Exception abgefangen: ${err.message}`, { stack: err.stack });
});

process.on('unhandledRejection', (reason) => {
  logger.error('CRASH_PREVENT', `Unhandled Promise Rejection abgefangen: ${reason}`);
});

/* ---------- Datenhaltung & Initialisierung ---------- */

function ensureData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  if (!fs.existsSync(PRODUCTS_FILE)) {
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(seedProducts(), null, 2));
    logger.info('SETUP', 'Initiales Sortiment in products.json angelegt.');
  }
  if (!fs.existsSync(ORDERS_FILE)) {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify({ orders: [] }, null, 2));
  }
  if (!fs.existsSync(ADMIN_KEY_FILE)) {
    const rawPw = 'admin-' + crypto.randomBytes(4).toString('hex');
    const hash = hashPw(rawPw);
    fs.writeFileSync(ADMIN_KEY_FILE, hash + '\n');
    logger.audit('SECURITY', 'Neues Admin-Passwort generiert: ' + rawPw);
  }
  if (!fs.existsSync(SESSION_FILE)) {
    fs.writeFileSync(SESSION_FILE, JSON.stringify({}, null, 2));
  }
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({
      whatsappNumber: '',
      facebookProfile: '',
      shopName: 'Uptempo Store',
      paymentMethod: 'vorkasse',
      bankHolder: 'David Puchalla',
      bankIban: 'DE00 0000 0000 0000 0000 00',
      bankBic: 'GENODEF1XXX',
      bankName: 'Volksbank',
      bankNote: 'Bestellnummer als Verwendungszweck angeben',
      paypalLink: '',
      stripePaymentLink: '',
      pricingRules: {
        vatRate: 0.19,
        targetMargin: 0.40,
        fixedSurchargeNet: 0,
        charmPricing: true,
        includeFreightInVk: false,
      },
      marketplaceFees: {
        ebay: { fixedFee: 0.35, percentageFee: 0.11 },
        kleinanzeigen: { fixedFee: 0.00, percentageFee: 0.05 },
        kaufland: { fixedFee: 0.00, percentageFee: 0.08 },
        otto: { fixedFee: 0.00, percentageFee: 0.15 }
      },
      marketplace: {
        kaufland: { enabled: false, mode: "dryRun", apiKey: "", secret: "", clientKey: "", baseUrl: "https://sellerapi.kaufland.com/v2" },
        otto: { enabled: false, mode: "dryRun", clientId: "", clientSecret: "", baseUrl: "https://api.otto.market/v1", tokenUrl: "https://api.otto.market/v1/token" },
        ebay: { enabled: false, mode: "dryRun", clientId: "", clientSecret: "", refreshToken: "", baseUrl: "https://api.ebay.com" },
        kleinanzeigen: { enabled: false, mode: "dryRun", bridgeUrl: "" }
      },
    }, null, 2));
  }
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeJsonAtomic(file, obj) {
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

function hashPw(pw) {
  return crypto.createHash('sha256').update('wawi-salt::' + pw).digest('hex');
}

function seedProducts() {
  const now = new Date().toISOString();
  return {
    products: [
      {
        id: 'uptempo-hardcore-crewneck',
        sku: 'UT-001',
        name: 'Uptempo Hardcore Crewneck',
        category: 'Pullover',
        price: 49.90,
        supplierEkNet: 18.50,
        sizes: ['S', 'M', 'L', 'XL'],
        stock: 25,
        description: 'Schwerer 450gsm Crewneck, Festival-tauglich, Oversized-Fit.',
        image: '',
        active: true,
        isWhitelisted: true,
        status: 'approved',
        created: now,
      },
      {
        id: 'rawstyle-cap',
        sku: 'UT-002',
        name: 'Rawstyle Snapback Cap',
        category: 'Accessoires',
        price: 19.90,
        supplierEkNet: 7.20,
        sizes: ['One Size'],
        stock: 40,
        description: 'Schwarz mit gesticktem Logo, verstellbarer Verschluss.',
        image: '',
        active: true,
        isWhitelisted: true,
        status: 'approved',
        created: now,
      },
      {
        id: 'gabber-flag',
        sku: 'UT-003',
        name: 'Gabber Party Flag 1x1m',
        category: 'Deko',
        price: 12.90,
        supplierEkNet: 4.50,
        sizes: ['1x1m'],
        stock: 60,
        description: 'Digitale Flagge fürs Festival-Dach oder die Wand.',
        image: '',
        active: true,
        isWhitelisted: true,
        status: 'approved',
        created: now,
      },
      {
        id: 'hardcore-lanyard',
        sku: 'UT-004',
        name: 'Schlüsselband / Lanyard Hardcore',
        category: 'Accessoires',
        price: 6.90,
        supplierEkNet: 1.80,
        sizes: ['Standard'],
        stock: 100,
        description: 'Robustes Festival-Lanyard mit Sicherheitsverschluss.',
        image: '',
        active: true,
        isWhitelisted: true,
        status: 'approved',
        created: now,
      },
    ],
  };
}

/* ---------- Backup-System ---------- */

function backupNow(reason = 'manual') {
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const targetDir = path.join(BACKUP_DIR, `backup-${ts}-${reason}`);
    fs.mkdirSync(targetDir, { recursive: true });

    if (fs.existsSync(PRODUCTS_FILE)) fs.copyFileSync(PRODUCTS_FILE, path.join(targetDir, 'products.json'));
    if (fs.existsSync(ORDERS_FILE)) fs.copyFileSync(ORDERS_FILE, path.join(targetDir, 'orders.json'));
    if (fs.existsSync(CONFIG_FILE)) fs.copyFileSync(CONFIG_FILE, path.join(targetDir, 'config.json'));

    const all = fs.readdirSync(BACKUP_DIR)
      .map(f => path.join(BACKUP_DIR, f))
      .filter(f => fs.statSync(f).isDirectory())
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

    while (all.length > 20) {
      const rm = all.pop();
      fs.rmSync(rm, { recursive: true, force: true });
    }
    logger.audit('BACKUP', `Automatisches Backup erstellt: ${path.basename(targetDir)}`);
    return { ok: true, path: targetDir };
  } catch (err) {
    logger.error('BACKUP', `Backup fehlgeschlagen: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

/* ---------- Manager Instanzen ---------- */

const catalogMgr = new CatalogManager(PRODUCTS_FILE, CONFIG_FILE);
const orderMgr = new OrderManager(ORDERS_FILE, catalogMgr);
const channelsMgr = new ChannelsManager(catalogMgr, readConfig);
const marketplaceRegistry = new MarketplaceRegistry(catalogMgr, readConfig, orderMgr);

/* ---------- Session & Auth ---------- */

function checkToken(token) {
  if (!token) return false;
  try {
    const sessions = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    const exp = sessions[token];
    if (!exp) return false;
    if (Date.now() > exp) {
      delete sessions[token];
      writeJsonAtomic(SESSION_FILE, sessions);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function createSession() {
  const token = crypto.randomBytes(24).toString('hex');
  const sessions = fs.existsSync(SESSION_FILE) ? JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')) : {};
  sessions[token] = Date.now() + 1000 * 60 * 60 * 24; // 24h
  writeJsonAtomic(SESSION_FILE, sessions);
  return token;
}

/* ---------- HTTP Response Helpers ---------- */

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(obj, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 50 * 1024 * 1024) {
        reject(new Error('Payload überschreitet Limit (50MB)'));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({ _raw: raw });
      }
    });
    req.on('error', reject);
  });
}

function servePublic(res, urlPath) {
  let file = path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 - nicht gefunden'); return; }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
    });
    res.end(data);
  });
}

/* ---------- Server & Router mit Tracing ---------- */

const server = http.createServer(async (req, res) => {
  const reqStart = process.hrtime.bigint();
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;

  res.on('finish', () => {
    const reqEnd = process.hrtime.bigint();
    const durationMs = (Number(reqEnd - reqStart) / 1_000_000).toFixed(2);
    logger.debug('HTTP', `${req.method} ${p} -> ${res.statusCode} (${durationMs}ms)`);
  });

  try {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');

    // 1. Statische Dateien
    if (req.method === 'GET' && !p.startsWith('/api/')) {
      return servePublic(res, p);
    }

    // 2. Öffentliche Feeds für Google Shopping, Meta Catalog & Instagram Shop
    if (p === '/api/channels/google-shopping.xml' && req.method === 'GET') {
      const origin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host || 'localhost:' + PORT}`;
      const xml = channelsMgr.generateGoogleShoppingXml(origin);
      res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
      return res.end(xml);
    }

    // 3. Health & System-Metriken
    if (p === '/api/health' && req.method === 'GET') {
      const metrics = logger.getSystemMetrics();
      const prods = catalogMgr.loadProducts();
      const orders = orderMgr.loadOrders();

      return sendJson(res, 200, {
        status: 'ok',
        host: HOSTNAME,
        time: new Date().toISOString(),
        uptimeSec: metrics.uptimeSec,
        memory: metrics.memory,
        productsCount: prods.length,
        ordersCount: orders.length,
        backupCount: fs.readdirSync(BACKUP_DIR).length,
      });
    }

    // 4. Öffentliche Produktliste (Shop)
    if (p === '/api/products' && req.method === 'GET') {
      const active = catalogMgr.getAll({ activeOnly: true });
      return sendJson(res, 200, { products: active });
    }

    // 5. Öffentliche Konfiguration
    if (p === '/api/config' && req.method === 'GET') {
      const cfg = readConfig();
      return sendJson(res, 200, {
        whatsappNumber: cfg.whatsappNumber || '',
        facebookProfile: cfg.facebookProfile || '',
        shopName: cfg.shopName || 'Uptempo Store',
        paymentMethod: cfg.paymentMethod || 'vorkasse',
        paypalLink: Boolean(cfg.paypalLink),
        stripePaymentLink: Boolean(cfg.stripePaymentLink),
      });
    }

    // 6. Öffentliche Bestellung
    if (p === '/api/orders' && req.method === 'POST') {
      const body = await readBody(req);
      const { items, customer, paymentMethod } = body;

      if (!Array.isArray(items) || items.length === 0) {
        return sendJson(res, 400, { ok: false, error: 'Warenkorb ist leer' });
      }
      if (!customer || !customer.name || !customer.email || !customer.street || !customer.zip || !customer.city) {
        return sendJson(res, 400, { ok: false, error: 'Lieferadresse unvollständig' });
      }

      const products = catalogMgr.loadProducts();
      let total = 0;
      const lineItems = [];

      for (const it of items) {
        const prod = products.find(p => p.id === it.productId);
        if (!prod) return sendJson(res, 400, { ok: false, error: 'Artikel unbekannt: ' + it.productId });
        if (prod.stock < it.quantity) {
          return sendJson(res, 400, { ok: false, error: `Bestand für ${prod.name} reicht nicht aus (nur ${prod.stock} verfügbar)` });
        }
        const itemTotal = prod.price * it.quantity;
        total += itemTotal;
        lineItems.push({
          productId: prod.id,
          name: prod.name,
          sku: prod.sku,
          size: it.size || '',
          price: prod.price,
          quantity: it.quantity,
          total: itemTotal,
        });
      }

      const order = orderMgr.createOrder({
        customer,
        items: lineItems,
        total,
        paymentMethod: paymentMethod || 'vorkasse',
      });

      backupNow('order-' + order.id);

      const cfg = readConfig();
      const payment = {
        method: paymentMethod || cfg.paymentMethod || 'vorkasse',
        instructions: '',
        links: {},
      };

      if (payment.method === 'paypal' && cfg.paypalLink) {
        payment.links.paypal = cfg.paypalLink;
        payment.instructions = 'Nach dem Klick auf "Jetzt mit PayPal zahlen" wird deine Zahlung direkt verarbeitet.';
      } else if (payment.method === 'stripe' && cfg.stripePaymentLink) {
        payment.links.stripe = cfg.stripePaymentLink;
        payment.instructions = 'Nach dem Klick auf den Zahlungslink wird deine Zahlung per Kreditkarte/Lastschrift verarbeitet.';
      } else {
        payment.method = 'vorkasse';
        payment.instructions = 'Überweise den Betrag innerhalb von 3 Tagen. Die Bestellung wird nach Geldeingang versendet.';
        payment.bank = {
          holder: cfg.bankHolder,
          iban: cfg.bankIban,
          bic: cfg.bankBic,
          bank: cfg.bankName,
          reference: 'Bestellung ' + order.id,
          note: cfg.bankNote,
        };
        payment.giroCodePayload = channelsMgr.generateGiroCodeString(order);
      }

      const waOrderText = channelsMgr.generateWhatsAppOrderText(order);

      return sendJson(res, 201, {
        ok: true,
        orderId: order.id,
        total,
        payment,
        whatsappNumber: cfg.whatsappNumber || '',
        whatsappMessageText: waOrderText,
      });
    }

    // 7. Admin Login
    if (p === '/api/admin/login' && req.method === 'POST') {
      const body = await readBody(req);
      const storedHash = fs.readFileSync(ADMIN_KEY_FILE, 'utf8').trim();
      if (hashPw(body.password || '') === storedHash) {
        const token = createSession();
        logger.audit('SECURITY', 'Erfolgreicher Admin-Login');
        return sendJson(res, 200, { ok: true, token });
      }
      logger.warn('SECURITY', 'Fehlgeschlagener Admin-Login-Versuch');
      return sendJson(res, 401, { ok: false, error: 'Passwort falsch' });
    }

    /* ---------- Admin-Geschützte Routen ---------- */

    const token = req.headers['x-admin-token'];
    if (p.startsWith('/api/admin/')) {
      if (!checkToken(token)) {
        return sendJson(res, 401, { ok: false, error: 'Nicht autorisiert' });
      }

      // Live-Debugging
      if (p === '/api/admin/debug/logs' && req.method === 'GET') {
        const limit = parseInt(u.searchParams.get('limit') || '100', 10);
        const level = u.searchParams.get('level') || null;
        const category = u.searchParams.get('category') || null;
        const logs = logger.getRecentLogs(limit, level, category);
        return sendJson(res, 200, { logs, metrics: logger.getSystemMetrics() });
      }

      if (p === '/api/admin/debug/system' && req.method === 'GET') {
        return sendJson(res, 200, logger.getSystemMetrics());
      }

      // Bestellungen
      if (p === '/api/admin/orders' && req.method === 'GET') {
        return sendJson(res, 200, { orders: orderMgr.getAll() });
      }

      if (p.startsWith('/api/admin/orders/') && p.endsWith('/status') && req.method === 'POST') {
        const orderId = p.split('/')[4];
        const body = await readBody(req);
        const order = orderMgr.updateStatus(orderId, body.status, body.notes);
        if (!order) return sendJson(res, 404, { ok: false, error: 'Bestellung nicht gefunden' });
        return sendJson(res, 200, { ok: true, order });
      }

      if (p.startsWith('/api/admin/orders/') && p.endsWith('/tracking') && req.method === 'POST') {
        const orderId = p.split('/')[4];
        const body = await readBody(req);
        const order = orderMgr.setTracking(orderId, body.trackingNumber, body.carrier || 'DHL');
        if (!order) return sendJson(res, 404, { ok: false, error: 'Bestellung nicht gefunden' });
        return sendJson(res, 200, { ok: true, order });
      }

      // Produkte & Katalog
      if (p === '/api/admin/products' && req.method === 'GET') {
        return sendJson(res, 200, { products: catalogMgr.loadProducts() });
      }

      if (p === '/api/admin/products' && req.method === 'POST') {
        const body = await readBody(req);
        const prod = catalogMgr.upsertProduct(body);
        return sendJson(res, 201, { ok: true, product: prod });
      }

      // Whitelist
      if (p === '/api/admin/catalog/whitelist' && req.method === 'POST') {
        const body = await readBody(req);
        const prod = catalogMgr.setWhitelist(body.id, body.isWhitelisted);
        if (!prod) return sendJson(res, 404, { ok: false, error: 'Produkt nicht gefunden' });
        return sendJson(res, 200, { ok: true, product: prod });
      }

      // XML Import
      if (p === '/api/admin/catalog/import-xml' && req.method === 'POST') {
        const body = await readBody(req);
        let xmlData = body.xml || body._raw;
        if (body.filePath && fs.existsSync(body.filePath)) {
          xmlData = fs.readFileSync(body.filePath, 'utf8');
        }

        if (!xmlData) {
          return sendJson(res, 400, { ok: false, error: 'Keine XML-Daten angegeben' });
        }

        let imported = 0;
        const { normalizeMatterhornToWaWi } = require('./modules/mapper');
        const result = await parseMatterhornXml(xmlData, async (prod) => {
          const waWi = normalizeMatterhornToWaWi(prod, { forceWhitelist: Boolean(body.forceWhitelist) });
          // Default-Preis bis Pricing-Regel appliziert wird (Fallback)
          if (!waWi.price || waWi.price <= 0) {
            const ekNet = waWi.supplierEkNet || 0;
            waWi.price = ekNet > 0 ? Math.round(ekNet * 1.6 * 1.19 * 100) / 100 - 0.10 : 0;
          }
          catalogMgr.upsertProduct(waWi);
          imported++;
        });

        return sendJson(res, 200, { ok: true, parsed: result.totalParsed, imported });
      }

      // Preiskalkulator
      if (p === '/api/admin/pricing/calculate' && req.method === 'POST') {
        const body = await readBody(req);
        const cfg = readConfig();
        const platform = body.platform || 'shop'; // 'shop' (standard), 'ebay', 'kleinanzeigen', etc.
        const fees = cfg.marketplaceFees && cfg.marketplaceFees[platform] ? cfg.marketplaceFees[platform] : {};
        
        const result = calculateProductPrice({
          supplierNet: Number(body.supplierNet || 0),
          dropshippingFeeNet: Number(body.dropshippingFeeNet || 0),
          freightAllocatedNet: Number(body.freightAllocatedNet || 0),
          priceRule: {
            id: 'sim',
            name: 'Simulation',
            vatRate: Number(body.vatRate !== undefined ? body.vatRate : 0.19),
            targetMargin: Number(body.targetMargin !== undefined ? body.targetMargin : 0.40),
            fixedSurchargeNet: Number(body.fixedSurchargeNet || 0),
            charmPricing: body.charmPricing !== false,
            includeFreightInVk: Boolean(body.includeFreightInVk),
            mode: 'brutto',
          },
        }, fees);
        return sendJson(res, 200, { ok: true, result });
      }

      if (p === '/api/admin/pricing/apply' && req.method === 'POST') {
        const body = await readBody(req);
        const cfg = readConfig();
        const platform = body.platform || 'shop';
        const _mf = cfg.marketplaceFees && cfg.marketplaceFees[platform] ? cfg.marketplaceFees[platform] : {};
        const fees = { ..._mf, _platform: platform };
        
        const rule = {
          id: 'applied',
          name: 'Regel',
          vatRate: Number(body.vatRate !== undefined ? body.vatRate : 0.19),
          targetMargin: Number(body.targetMargin !== undefined ? body.targetMargin : 0.40),
          fixedSurchargeNet: Number(body.fixedSurchargeNet || 0),
          charmPricing: body.charmPricing !== false,
          includeFreightInVk: Boolean(body.includeFreightInVk),
          mode: 'brutto',
        };
        const resApply = catalogMgr.applyPricingRule(rule, body.productId || null, fees);
        return sendJson(res, 200, { ok: true, updatedCount: resApply.updatedCount });
      }

      // Multi-Channel Generator Endpoints (Mapper-backed, alle Felder + Optionen)
      // GET /api/admin/channels/facebook/:id  -> Facebook Listing (legacy kompatibel)
      if (p.startsWith('/api/admin/channels/facebook/') && req.method === 'GET') {
        const prodId = p.split('/')[5];
        const prod = catalogMgr.getById(prodId);
        if (!prod) return sendJson(res, 404, { ok: false, error: 'Produkt nicht gefunden' });
        const { mapWaWiToFacebook } = require('./modules/mapper');
        const mapped = mapWaWiToFacebook(prod);
        // Legacy Format beibehalten + Mapping anhaengen
        const legacy = channelsMgr.generateFacebookListing(prod);
        return sendJson(res, 200, { ok: true, listing: legacy, mapped });
      }

      if (p.startsWith('/api/admin/channels/kleinanzeigen/') && req.method === 'GET') {
        const prodId = p.split('/')[5];
        const prod = catalogMgr.getById(prodId);
        if (!prod) return sendJson(res, 404, { ok: false, error: 'Produkt nicht gefunden' });
        const { mapWaWiToKleinanzeigen } = require('./modules/mapper');
        const mapped = mapWaWiToKleinanzeigen(prod);
        const legacy = channelsMgr.generateKleinanzeigenListing(prod);
        return sendJson(res, 200, { ok: true, listing: legacy, mapped });
      }

      if (p.startsWith('/api/admin/channels/telegram/') && req.method === 'GET') {
        const prodId = p.split('/')[5];
        const prod = catalogMgr.getById(prodId);
        if (!prod) return sendJson(res, 404, { ok: false, error: 'Produkt nicht gefunden' });
        return sendJson(res, 200, { ok: true, post: channelsMgr.generateTelegramDropPost(prod) });
      }

      if (p === '/api/admin/channels/feed.csv' && req.method === 'GET') {
        const csv = channelsMgr.exportProductsCsv();
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="products-feed.csv"',
        });
        return res.end(csv);
      }

      // Unified Channel Mapping API (reibugslose Uebertragung)
      // GET /api/admin/channels/map/:channel/:id  -> channel in shop,shopware,ebay,kleinanzeigen,kaufland,otto,google,facebook
      if (p.startsWith('/api/admin/channels/map/') && req.method === 'GET') {
        const parts = p.split('/');
        // /api/admin/channels/map/<channel>/<id>
        const channel = parts[5] || 'shop';
        const prodId = parts[6] || '';
        const prod = catalogMgr.getById(prodId);
        if (!prod) return sendJson(res, 404, { ok: false, error: 'Produkt nicht gefunden' });
        const { mapWaWiToChannel } = require('./modules/mapper');
        const urlObj = new URL(req.url, 'http://localhost');
        const baseUrl = urlObj.searchParams.get('baseUrl') || `http://localhost:${PORT}`;
        const mapped = mapWaWiToChannel(prod, channel, { baseUrl });
        return sendJson(res, 200, { ok: true, channel, id: prodId, mapped });
      }

      // POST /api/admin/channels/map/:channel  { ids: [...] } -> Batch-Mapping
      if (p.startsWith('/api/admin/channels/map/') && req.method === 'POST') {
        const parts = p.split('/');
        const channel = parts[5] || 'shop';
        const body = await readBody(req);
        const ids = Array.isArray(body.ids) ? body.ids : [];
        if (!ids.length) return sendJson(res, 400, { ok: false, error: 'ids[] erforderlich' });
        const { mapWaWiToChannel } = require('./modules/mapper');
        const urlObj = new URL(req.url, 'http://localhost');
        const baseUrl = body.baseUrl || urlObj.searchParams.get('baseUrl') || `http://localhost:${PORT}`;
        const items = [];
        for (const id of ids) {
          const prod = catalogMgr.getById(String(id));
          if (!prod) { items.push({ id, ok: false, error: 'nicht gefunden' }); continue; }
          items.push({ id, ok: true, mapped: mapWaWiToChannel(prod, channel, { baseUrl }) });
        }
        return sendJson(res, 200, { ok: true, channel, count: items.length, items });
      }

      // GET /api/admin/channels/export/:channel  -> Export aller whitelisted Produkte fuer Channel
      if (p.startsWith('/api/admin/channels/export/') && req.method === 'GET') {
        const channel = p.split('/')[5] || 'shop';
        const list = catalogMgr.loadProducts().filter(pr => pr.isWhitelisted || pr.active);
        const { mapWaWiToChannel } = require('./modules/mapper');
        const urlObj = new URL(req.url, 'http://localhost');
        const baseUrl = urlObj.searchParams.get('baseUrl') || `http://localhost:${PORT}`;
        const items = list.map(pr => mapWaWiToChannel(pr, channel, { baseUrl }));
        return sendJson(res, 200, { ok: true, channel, count: items.length, items });
      }

      // Marketplace API (Kaufland/Otto/eBay/Kleinanzeigen) — DryRun default, echte Calls nur mit enabled:true
      if (p === '/api/admin/marketplace/status' && req.method === 'GET') {
        const status = await marketplaceRegistry.getStatus();
        return sendJson(res, 200, { ok: true, status });
      }
      if (p.startsWith('/api/admin/marketplace/') && p.endsWith('/health') && req.method === 'GET') {
        const channel = p.split('/')[4];
        try {
          const ad = marketplaceRegistry.getAdapter(channel);
          const h = await ad.healthCheck();
          return sendJson(res, 200, { ok: true, channel, health: h });
        } catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }
      }
      if (p.startsWith('/api/admin/marketplace/') && p.endsWith('/push') && req.method === 'POST') {
        const channel = p.split('/')[4];
        const body = await readBody(req);
        const ids = body.ids ? body.ids : (body.id ? [body.id] : []);
        if (!ids.length) return sendJson(res, 400, { ok: false, error: 'id oder ids[] erforderlich' });
        try {
          const r = await marketplaceRegistry.pushProducts(channel, ids.map(String));
          return sendJson(res, 200, { ok: true, channel, ...r });
        } catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }
      }
      if (p.startsWith('/api/admin/marketplace/') && p.endsWith('/sync-stock') && req.method === 'POST') {
        const channel = p.split('/')[4];
        const body = await readBody(req);
        const ids = body.ids ? body.ids : (body.id ? [body.id] : []);
        if (!ids.length) return sendJson(res, 400, { ok: false, error: 'id oder ids[] erforderlich' });
        const ad = marketplaceRegistry.getAdapter(channel);
        const results = [];
        for (const id of ids) {
          try { const r = await ad.pushStock(String(id)); results.push({ id, ok: true, ...r }); } catch (e) { results.push({ id, ok: false, error: e.message }); }
        }
        return sendJson(res, 200, { ok: true, channel, results });
      }
      if (p.startsWith('/api/admin/marketplace/') && p.endsWith('/sync-price') && req.method === 'POST') {
        const channel = p.split('/')[4];
        const body = await readBody(req);
        const ids = body.ids ? body.ids : (body.id ? [body.id] : []);
        if (!ids.length) return sendJson(res, 400, { ok: false, error: 'id oder ids[] erforderlich' });
        const ad = marketplaceRegistry.getAdapter(channel);
        const results = [];
        for (const id of ids) {
          try { const r = await ad.pushPrice(String(id)); results.push({ id, ok: true, ...r }); } catch (e) { results.push({ id, ok: false, error: e.message }); }
        }
        return sendJson(res, 200, { ok: true, channel, results });
      }
      if (p.startsWith('/api/admin/marketplace/') && p.endsWith('/import-orders') && req.method === 'POST') {
        const channel = p.split('/')[4];
        const body = await readBody(req);
        try {
          const r = await marketplaceRegistry.importOrders(channel, body.since || null);
          return sendJson(res, 200, { ok: true, channel, ...r });
        } catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }
      }
      if (p.startsWith('/api/admin/marketplace/') && p.endsWith('/tracking') && req.method === 'POST') {
        const channel = p.split('/')[4];
        const body = await readBody(req);
        if (!body.orderId || !body.trackingNumber) return sendJson(res, 400, { ok: false, error: 'orderId + trackingNumber erforderlich' });
        try {
          const r = await marketplaceRegistry.pushTracking(channel, String(body.orderId), { trackingNumber: String(body.trackingNumber), carrier: String(body.carrier || 'DHL') });
          return sendJson(res, 200, { ok: true, channel, ...r });
        } catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }
      }
      if (p === '/api/admin/marketplace/sync-all' && req.method === 'POST') {
        const body = await readBody(req);
        const channels = Array.isArray(body.channels) && body.channels.length ? body.channels : ['kaufland','otto','ebay','kleinanzeigen'];
        const productIds = Array.isArray(body.productIds) ? body.productIds.map(String) : null;
        const r = await marketplaceRegistry.syncAll(channels, { productIds, importOrders: Boolean(body.importOrders), since: body.since || null, limit: Number(body.limit || 20) });
        return sendJson(res, 200, { ok: true, result: r });
      }

      // Config
      if (p === '/api/admin/config' && req.method === 'GET') {
        return sendJson(res, 200, readConfig());
      }

      if (p === '/api/admin/config' && req.method === 'POST') {
        const body = await readBody(req);
        const cfg = readConfig();

        if (typeof body.whatsappNumber === 'string') {
          const num = body.whatsappNumber.trim();
          if (num === '' || /^\+?[0-9\s-]{6,20}$/.test(num)) cfg.whatsappNumber = num;
        }
        if (typeof body.facebookProfile === 'string') cfg.facebookProfile = body.facebookProfile.trim();
        if (typeof body.shopName === 'string' && body.shopName.trim()) cfg.shopName = body.shopName.trim();
        if (typeof body.paymentMethod === 'string') cfg.paymentMethod = body.paymentMethod.trim();
        if (typeof body.bankHolder === 'string') cfg.bankHolder = body.bankHolder.trim();
        if (typeof body.bankIban === 'string') cfg.bankIban = body.bankIban.trim();
        if (typeof body.bankBic === 'string') cfg.bankBic = body.bankBic.trim();
        if (typeof body.bankName === 'string') cfg.bankName = body.bankName.trim();
        if (typeof body.bankNote === 'string') cfg.bankNote = body.bankNote.trim();
        if (typeof body.paypalLink === 'string') cfg.paypalLink = body.paypalLink.trim();
        if (typeof body.stripePaymentLink === 'string') cfg.stripePaymentLink = body.stripePaymentLink.trim();
        if (body.pricingRules && typeof body.pricingRules === 'object') {
          cfg.pricingRules = { ...cfg.pricingRules, ...body.pricingRules };
        }
        if (body.marketplaceFees && typeof body.marketplaceFees === 'object') {
          cfg.marketplaceFees = { ...cfg.marketplaceFees, ...body.marketplaceFees };
        }
        if (body.marketplace && typeof body.marketplace === 'object') {
          cfg.marketplace = cfg.marketplace || {};
          for (const ch of ['kaufland','otto','ebay','kleinanzeigen']) {
            if (body.marketplace[ch] && typeof body.marketplace[ch] === 'object') {
              cfg.marketplace[ch] = { ...(cfg.marketplace[ch] || {}), ...body.marketplace[ch] };
            }
          }
        }

        writeJsonAtomic(CONFIG_FILE, cfg);
        return sendJson(res, 200, { ok: true, config: cfg });
      }

      // Backup
      if (p === '/api/admin/backup' && req.method === 'POST') {
        const b = backupNow('admin-manual');
        return sendJson(res, 200, b);
      }
    }

    sendJson(res, 404, { ok: false, error: 'Endpoint nicht gefunden' });
  } catch (err) {
    logger.error('HTTP_ERROR', `Fehler bei Anfrage ${p}: ${err.message}`, { stack: err.stack });
    sendJson(res, 500, { ok: false, error: 'Interner Serverfehler' });
  }
});

/* ---------- Start ---------- */

ensureData();
server.listen(PORT, '0.0.0.0', () => {
  logger.info('STARTUP', `WaWi-Produktivserver läuft auf Port ${PORT} (http://0.0.0.0:${PORT})`);
  logger.info('STARTUP', `Google Shopping Feed: http://localhost:${PORT}/api/channels/google-shopping.xml`);
  logger.info('STARTUP', `Admin-Panel: http://localhost:${PORT}/admin.html`);
});
