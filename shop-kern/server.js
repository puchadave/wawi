#!/usr/bin/env node
/**
 * WaWi Shop-Kern v2.0 — Selbstheilendes Produktivsystem
 * 100% Node.js-Stdlib, KEINE externen Pakete, KEIN Docker, KEINE Build-Stufe.
 * Läuft auf jedem System mit `nodejs` (Alpine LXC, Debian, direkt auf PVE).
 *
 * Start:   node server.js [PORT]            (Default 8080)
 * Daten:   ./data/products.json (Sortiment)
 *          ./data/orders.json   (Bestellungen, atomar geschrieben)
 *          ./data/admin.key     (Admin-Passwort-Hash, wird beim 1. Start generiert)
 *
 * DSGVO-konform: keine externen Dienste, keine Tracker, keine CDNs.
 * Alle Daten bleiben auf dem eigenen Server.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = parseInt(process.argv[2] || process.env.PORT || '8080', 10);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const ADMIN_KEY_FILE = path.join(DATA_DIR, 'admin.key');
const SESSION_FILE = path.join(DATA_DIR, 'sessions.json');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

/* ---------- Datenhaltung (atomar, absturzsicher) ---------- */

function ensureData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PRODUCTS_FILE)) {
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(seedProducts(), null, 2));
  }
  if (!fs.existsSync(ORDERS_FILE)) {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify({ orders: [], seq: 1000 }, null, 2));
  }
  if (!fs.existsSync(ADMIN_KEY_FILE)) {
    const pw = 'wawi-' + crypto.randomBytes(4).toString('hex');
    fs.writeFileSync(ADMIN_KEY_FILE, hashPw(pw));
    fs.writeFileSync(path.join(DATA_DIR, 'admin-passwort.txt'), pw + '\n', { mode: 0o600 });
    log('[i] Admin-Passwort generiert: ' + pw + ' (gespeichert in data/admin-passwort.txt)');
  }
  if (!fs.existsSync(SESSION_FILE)) fs.writeFileSync(SESSION_FILE, '{}');
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function writeJsonAtomic(file, obj) {
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

function hashPw(pw) {
  return crypto.createHash('sha256').update('wawi-salt::' + pw).digest('hex');
}

function log(msg) {
  console.log('[' + new Date().toISOString() + '] ' + msg);
}

/* ---------- Sortiment (Festival/DJ-Bekleidung, Start-Lieferung) ---------- */

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
        sizes: ['S', 'M', 'L', 'XL'],
        stock: 25,
        description: 'Schwerer 450gsm Crewneck, Festival-tauglich, Oversized-Fit.',
        image: '',
        active: true,
        created: now,
      },
      {
        id: 'rawstyle-cap',
        sku: 'UT-002',
        name: 'Rawstyle Snapback Cap',
        category: 'Accessoires',
        price: 19.90,
        sizes: ['One Size'],
        stock: 40,
        description: 'Schwarz mit gesticktem Logo, verstellbarer Verschluss.',
        image: '',
        active: true,
        created: now,
      },
      {
        id: 'gabber-flag',
        sku: 'UT-003',
        name: 'Gabber Party Flag 1x1m',
        category: 'Deko',
        price: 12.90,
        sizes: ['1x1m'],
        stock: 60,
        description: 'Digitale Flagge fürs Festival-Dach oder die Wand.',
        image: '',
        active: true,
        created: now,
      },
      {
        id: 'hardcore-lanyard',
        sku: 'UT-004',
        name: 'Hardcore Lanyard',
        category: 'Accessoires',
        price: 6.90,
        sizes: ['One Size'],
        stock: 100,
        description: 'Lanyard mit Karabiner, QR-Code-Print.',
        image: '',
        active: true,
        created: now,
      },
      {
        id: 'uptempo-sticker-pack',
        sku: 'UT-005',
        name: 'Uptempo Sticker Pack (10)',
        category: 'Deko',
        price: 9.90,
        sizes: ['10 Stück'],
        stock: 200,
        description: '10 wetterfeste Vinyl-Sticker, diverse Designs.',
        image: '',
        active: true,
        created: now,
      },
      {
        id: 'djane-oversized-tee',
        sku: 'UT-006',
        name: 'DJane Oversized Tee',
        category: 'T-Shirts',
        price: 29.90,
        sizes: ['S', 'M', 'L'],
        stock: 30,
        description: 'Oversized-Fit, Bio-Baumwolle, bedruckt in DE.',
        image: '',
        active: true,
        created: now,
      },
    ],
    updated: now,
  };
}

/* ---------- API ---------- */

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function getBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('PAYLOAD_TOO_LARGE')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function isAuthed(req) {
  const h = req.headers['x-admin-token'];
  if (!h) return false;
  const sessions = readJson(SESSION_FILE, {});
  const s = sessions[h];
  return s && s.expires > Date.now();
}

function validEmail(e) {
  return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());
}

/* ---------- DHL Live-Tracking (echte Sendungsnummer, kein Fake) ---------- */

function dhlTracking(number) {
  const n = String(number || '').trim();
  if (!n) return null;
  return {
    carrier: 'DHL',
    number: n,
    url: 'https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=' + encodeURIComponent(n),
    at: new Date().toISOString(),
  };
}

/* ---------- Shop-Frontend ---------- */

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

/* ---------- Router ---------- */

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    const p = u.pathname;

    // CORS nur minimal (same-origin Shop) — kein wildcard für Daten
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');

    // Statische Dateien
    if (req.method === 'GET' && !p.startsWith('/api/')) {
      return servePublic(res, p);
    }

    // API
    if (p === '/api/products' && req.method === 'GET') {
      const data = readJson(PRODUCTS_FILE, { products: [] });
      return sendJson(res, 200, { products: data.products.filter(x => x.active) });
    }

    if (p === '/api/order' && req.method === 'POST') {
      const body = JSON.parse(await getBody(req));
      const { customer, items } = body;
      if (!customer || !items || !Array.isArray(items) || items.length === 0) {
        return sendJson(res, 400, { error: 'UNVOLLSTAENDIGE_BESTELLUNG' });
      }
      if (!customer.name || !customer.name.trim() || customer.name.trim().length < 2) {
        return sendJson(res, 400, { error: 'NAME_FEHLT' });
      }
      if (!validEmail(customer.email)) {
        return sendJson(res, 400, { error: 'EMAIL_UNGUELTIG' });
      }
      if (!customer.street || !customer.zip || !customer.city) {
        return sendJson(res, 400, { error: 'ADRESSE_UNVOLLSTAENDIG' });
      }

      const store = readJson(PRODUCTS_FILE, { products: [] });
      const orders = readJson(ORDERS_FILE, { orders: [], seq: 1000 });
      let total = 0;
      const lineItems = [];

      // Bestandsprüfung + Preis aus Sortiment (nie vom Client)
      for (const it of items) {
        const prod = store.products.find(x => x.id === it.id);
        if (!prod || !prod.active) return sendJson(res, 400, { error: 'PRODUKT_UNBEKANNT:' + it.id });
        if (prod.stock < (it.qty || 0)) return sendJson(res, 400, { error: 'BESTAND_ZU_NIEDRIG:' + prod.sku });
        const line = {
          product: prod.id,
          sku: prod.sku,
          name: prod.name,
          size: it.size || '',
          qty: parseInt(it.qty, 10) || 1,
          price: prod.price,
        };
        line.total = +(line.qty * prod.price).toFixed(2);
        total += line.total;
        lineItems.push(line);
        prod.stock -= line.qty;
      }

      total = +total.toFixed(2);
      orders.seq += 1;
      const order = {
        id: 'W-' + orders.seq,
        created: new Date().toISOString(),
        status: 'NEU',
        customer: {
          name: customer.name.trim(),
          email: customer.email.trim().toLowerCase(),
          phone: (customer.phone || '').trim(),
          street: customer.street.trim(),
          zip: customer.zip.trim(),
          city: customer.city.trim(),
          note: (customer.note || '').trim(),
        },
        items: lineItems,
        total,
        shipping: { method: 'express' },
      };
      orders.orders.push(order);
      writeJsonAtomic(ORDERS_FILE, orders);
      writeJsonAtomic(PRODUCTS_FILE, store);

      log('[BESTELLUNG] ' + order.id + ' von ' + order.customer.name + ' - ' + total.toFixed(2) + ' EUR');
      return sendJson(res, 201, { ok: true, orderId: order.id, total });
    }

    // ---- Admin ----
    if (p === '/api/admin/login' && req.method === 'POST') {
      const body = JSON.parse(await getBody(req));
      const stored = fs.readFileSync(ADMIN_KEY_FILE, 'utf8').trim();
      if (hashPw(String(body.password || '')) === stored) {
        const token = crypto.randomBytes(24).toString('hex');
        const sessions = readJson(SESSION_FILE, {});
        sessions[token] = { expires: Date.now() + 12 * 3600 * 1000 };
        writeJsonAtomic(SESSION_FILE, sessions);
        return sendJson(res, 200, { ok: true, token });
      }
      return sendJson(res, 401, { error: 'AUTH_FAILED' });
    }

    if (p === '/api/admin/orders' && req.method === 'GET') {
      if (!isAuthed(req)) return sendJson(res, 401, { error: 'UNAUTHORIZED' });
      const orders = readJson(ORDERS_FILE, { orders: [] });
      return sendJson(res, 200, { orders: orders.orders.slice().reverse() });
    }

    if (p === '/api/admin/order/status' && req.method === 'POST') {
      if (!isAuthed(req)) return sendJson(res, 401, { error: 'UNAUTHORIZED' });
      const body = JSON.parse(await getBody(req));
      const orders = readJson(ORDERS_FILE, { orders: [] });
      const o = orders.orders.find(x => x.id === body.id);
      if (!o) return sendJson(res, 404, { error: 'ORDER_NOT_FOUND' });
      const allowed = ['NEU', 'BEZAHLT', 'VERSENDET', 'ABGESCHLOSSEN', 'STORNIERT'];
      if (!allowed.includes(body.status)) return sendJson(res, 400, { error: 'STATUS_UNGUELTIG' });
      o.status = body.status;
      o.updated = new Date().toISOString();
      // Beim Versand: echte DHL-Sendungsnummer hinterlegen (Live-Tracking, kein Fake)
      if (body.status === 'VERSENDET') {
        if (body.tracking && String(body.tracking).trim()) {
          o.tracking = dhlTracking(body.tracking);
          if (body.carrier === 'kein-dhl') {
            o.tracking.carrier = 'ANDERER_DIENST';
          }
        } else {
          o.tracking = null;
          o.trackingWarning = 'Keine DHL-Sendungsnummer hinterlegt — Sendungsverfolgung fehlt!';
        }
      }
      writeJsonAtomic(ORDERS_FILE, orders);
      log('[STATUS] ' + o.id + ' -> ' + o.status);
      return sendJson(res, 200, { ok: true, order: o });
    }

    if (p === '/api/admin/export' && req.method === 'GET') {
      if (!isAuthed(req)) return sendJson(res, 401, { error: 'UNAUTHORIZED' });
      const orders = readJson(ORDERS_FILE, { orders: [] });
      const lines = ['Bestellnr;Datum;Status;Name;Email;PLZ;Ort;Strasse;Artikel;Anzahl;Summe;Tracking;Tracking-Link'];
      for (const o of orders.orders) {
        const artik = o.items.map(i => i.sku + 'x' + i.qty).join('|');
        const tr = o.tracking ? o.tracking.number : '';
        const trUrl = o.tracking ? o.tracking.url : '';
        lines.push([o.id, o.created, o.status, o.customer.name, o.customer.email, o.customer.zip, o.customer.city, o.customer.street, artik, o.items.reduce((a, i) => a + i.qty, 0), o.total.toFixed(2), tr, trUrl].join(';'));
      }
      const csv = lines.join('\n');
      const buf = Buffer.from('\uFEFF' + csv, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename=bestellungen.csv',
        'Content-Length': buf.length,
      });
      return res.end(buf);
    }

    return sendJson(res, 404, { error: 'NOT_FOUND' });
  } catch (e) {
    log('[FATAL] ' + (e && e.stack || e));
    if (!res.headersSent) return sendJson(res, 500, { error: 'SERVER_ERROR' });
    res.end();
  }
});

ensureData();
server.listen(PORT, '0.0.0.0', () => {
  log('==============================================');
  log('WaWi Shop-Kern v2.0 produktiv auf Port ' + PORT);
  log('Shop:   http://<host>:' + PORT + '/');
  log('Admin:  http://<host>:' + PORT + '/admin.html');
  log('Daten:  ' + DATA_DIR);
  log('==============================================');
});