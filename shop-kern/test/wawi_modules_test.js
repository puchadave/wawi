'use strict';
/**
 * Automatisierter Testsuite für alle WaWi-Module inkl. kontinuierlichem Debugging & Telemetrie
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const { logger } = require('../modules/logger');
const { calculateProductPrice } = require('../modules/pricing');
const { parseMatterhornXml } = require('../modules/xmlparser');
const { CatalogManager } = require('../modules/catalog');
const { OrderManager } = require('../modules/orders');
const { ChannelsManager } = require('../modules/channels');

console.log('--- TEST: 1. Debugging & Telemetry Engine ---');
{
  logger.info('TEST', 'Logging-Test gestartet');
  logger.time('TEST_TIMER');
  logger.debug('TEST', 'Debug Message with Meta', { foo: 'bar' });
  logger.timeEnd('TEST_TIMER', 'TEST_PERF');

  const logs = logger.getRecentLogs(10);
  assert.ok(logs.length > 0, 'Ringpuffer muss Einträge enthalten');
  const metrics = logger.getSystemMetrics();
  assert.ok(metrics.uptimeSec >= 0, 'Uptime muss positiv sein');
  assert.ok(metrics.memory.heapUsedMb > 0, 'Heap-Metrik muss existieren');
  console.log('✓ Debugging, Ringpuffer & Telemetrie erfolgreich!');
}

console.log('--- TEST: 2. Pricing Engine with Trace ---');
{
  const res = calculateProductPrice({
    supplierNet: 20.00,
    dropshippingFeeNet: 2.50,
    freightAllocatedNet: 1.50,
    priceRule: {
      vatRate: 0.19,
      targetMargin: 0.40,
      fixedSurchargeNet: 1.00,
      charmPricing: true,
      includeFreightInVk: true,
      mode: 'brutto',
    },
  });

  assert.strictEqual(res.shopEkNet, 25.00);
  assert.strictEqual(res.shopVkGross, 49.90);
  assert.ok(res.marginPercent >= 0.35);
  console.log('✓ Preiskalkulation & Charm-Pricing erfolgreich!');
}

console.log('--- TEST: 3. XML Parser with Performance Tracing ---');
(async () => {
  const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<products>
  <product id="10101">
    <name>Hardcore Festival Hoodie</name>
    <brand>Uptempo Brand</brand>
    <category_path>/Kleidung/Pullover</category_path>
    <price currency="EUR">24.50</price>
    <description><![CDATA[<p>Bester Hoodie</p>]]></description>
    <image_url>https://example.com/img1.jpg</image_url>
    <options>
      <option id="opt1">
        <option_name EU="L" />
        <stock>15</stock>
        <ean>426000000001</ean>
      </option>
      <option id="opt2">
        <option_name EU="XL" />
        <stock>8</stock>
        <ean>426000000002</ean>
      </option>
    </options>
  </product>
</products>`;

  let parsedProduct = null;
  const result = await parseMatterhornXml(sampleXml, async (prod) => {
    parsedProduct = prod;
  });

  assert.strictEqual(result.totalParsed, 1);
  assert.strictEqual(parsedProduct.id, '10101');
  assert.strictEqual(parsedProduct.name, 'Hardcore Festival Hoodie');
  console.log('✓ Matterhorn-XML Parsing erfolgreich!');

  console.log('--- TEST: 4. Catalog & Whitelist Manager ---');
  const testDataFile = path.join(__dirname, 'test_products.json');
  const testConfigFile = path.join(__dirname, 'test_config.json');
  fs.writeFileSync(testDataFile, JSON.stringify({ products: [] }));
  fs.writeFileSync(testConfigFile, JSON.stringify({ shopName: 'Test Shop' }));

  const catMgr = new CatalogManager(testDataFile, testConfigFile);
  const p = catMgr.upsertProduct({
    id: 'test-1',
    name: 'Test Shirt',
    supplierEkNet: 10.00,
    price: 24.90,
    stock: 20,
    isWhitelisted: false,
    active: false,
  });

  assert.strictEqual(catMgr.getAll().length, 1);
  assert.strictEqual(catMgr.getAll({ activeOnly: true }).length, 0);

  catMgr.setWhitelist('test-1', true);
  assert.strictEqual(catMgr.getAll({ activeOnly: true }).length, 1);
  assert.strictEqual(catMgr.getById('test-1').isWhitelisted, true);
  console.log('✓ Catalog & Whitelist-Management erfolgreich!');

  console.log('--- TEST: 5. Order Management & DHL Tracking ---');
  const testOrdersFile = path.join(__dirname, 'test_orders.json');
  fs.writeFileSync(testOrdersFile, JSON.stringify({ orders: [] }));

  const ordMgr = new OrderManager(testOrdersFile, catMgr);
  const order = ordMgr.createOrder({
    customer: { name: 'Max Mustermann', email: 'max@example.com', street: 'Musterstr. 1', zip: '12345', city: 'Berlin' },
    items: [{ productId: 'test-1', name: 'Test Shirt', quantity: 2, price: 24.90 }],
    total: 49.80,
  });

  assert.strictEqual(order.total, 49.80);
  assert.strictEqual(catMgr.getById('test-1').stock, 18);

  const updatedOrder = ordMgr.setTracking(order.id, '00340434200000000000');
  assert.strictEqual(updatedOrder.status, 'VERSENDET');
  assert.ok(updatedOrder.trackingUrl.includes('00340434200000000000'));
  console.log('✓ Order-Workflow & DHL Tracking erfolgreich!');

  console.log('--- TEST: 6. Channels & Multi-Channel Export ---');
  const chanMgr = new ChannelsManager(catMgr, () => ({ shopName: 'Test Store' }));
  const fbListing = chanMgr.generateFacebookListing(catMgr.getById('test-1'));
  assert.ok(fbListing.title.includes('Test Shirt'));
  assert.ok(fbListing.description.includes('DHL Paket mit Sendungsverfolgung'));

  const csv = chanMgr.exportProductsCsv();
  assert.ok(csv.includes('test-1'));
  console.log('✓ Multi-Channel Payloads (FB & CSV) erfolgreich!');

  try {
    fs.unlinkSync(testDataFile);
    fs.unlinkSync(testConfigFile);
    fs.unlinkSync(testOrdersFile);
  } catch {}

  console.log('========================================================');
  console.log('✅ ALLE 6 TEST-SUITEN (INKL. DEBUG-TRACING) BESTANDEN!');
  console.log('========================================================');
})();
