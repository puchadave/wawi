'use strict';
/**
 * WaWi Multi-Channel & Sales Expansion Engine
 * Generiert automatisierte Feeds, Listings und Direkt-Verkaufskanäle:
 *  - WhatsApp Klick-zu-Chat & Bestätigungen
 *  - Facebook Marketplace Listings
 *  - Google Shopping / Meta / Instagram Product Catalog XML Feed
 *  - eBay & Kleinanzeigen Listing Generator
 *  - Telegram Community Drop Generator
 *  - EPC-QR GiroCode Generator (SEPA Sofortüberweisung)
 */

const { logger } = require('./logger');

class ChannelsManager {
  constructor(catalogManager, configGetter) {
    this.catalogManager = catalogManager;
    this.getConfig = configGetter;
  }

  /**
   * Generiert eine strukturierte WhatsApp-Bestellnachricht für Kunden & Händler
   */
  generateWhatsAppOrderText(order) {
    const cfg = this.getConfig();
    const itemsList = (order.items || [])
      .map(it => `• ${it.quantity}x ${it.name}${it.size ? ' (Größe: ' + it.size + ')' : ''} — ${(it.price * it.quantity).toFixed(2)} €`)
      .join('\n');

    return (
      `🔥 *Neue Bestellung #${order.id}*\n` +
      `Shop: ${cfg.shopName || 'Uptempo Store'}\n\n` +
      `👤 *Kunde:*\n${order.customer.name}\n${order.customer.email}\n` +
      `📍 *Lieferadresse:*\n${order.customer.street || order.customer.address}, ${order.customer.zip || ''} ${order.customer.city || ''}\n\n` +
      `📦 *Bestellte Artikel:*\n${itemsList}\n\n` +
      `💰 *Gesamtsumme: ${order.total.toFixed(2)} EUR*\n` +
      `Zahlungsart: ${order.paymentMethod || 'Vorkasse'}\n` +
      (order.trackingNumber ? `🚚 *DHL Tracking:* ${order.trackingNumber}\n${order.trackingUrl}\n` : '') +
      `\nVielen Dank für deine Bestellung!`
    );
  }

  /**
   * Generiert den Text für ein Facebook Marketplace Listing
   */
  generateFacebookListing(product) {
    const cfg = this.getConfig();
    const priceFormatted = Number(product.price || 0).toFixed(2);
    const sizes = Array.isArray(product.sizes) && product.sizes.length > 0
      ? product.sizes.join(', ')
      : 'Standard';

    const title = `${product.name} ${product.brand ? '— ' + product.brand : ''}`.trim();
    const description = (
      `${product.description || product.name}\n\n` +
      `• Marke: ${product.brand || 'Original Festival Gear'}\n` +
      `• Verfügbare Größen: ${sizes}\n` +
      `• Zustand: Neu & Originalverpackt\n` +
      `• Festpreis: ${priceFormatted} €\n` +
      `• Versand: DHL Paket mit Sendungsverfolgung (Express möglich)\n` +
      `• Bezahlung: PayPal, Überweisung oder Bar bei Abholung\n\n` +
      `👉 Bei Interesse Direktnachricht schreiben oder per WhatsApp bestellen: ${cfg.whatsappNumber || ''}\n` +
      `Offizieller Store: ${cfg.shopName || 'Uptempo Store'}`
    );

    return {
      title,
      price: priceFormatted,
      category: product.category || 'Kleidung & Accessoires',
      description,
      sku: product.sku || product.id,
      images: product.images || (product.image ? [product.image] : []),
    };
  }

  /**
   * Generiert Kleinanzeigen / eBay Vorlage mit Conversion-Triggern
   */
  generateKleinanzeigenListing(product) {
    const cfg = this.getConfig();
    const price = Number(product.price || 0).toFixed(2);
    const title = `NEU: ${product.name} [Größe: ${(product.sizes || []).join('/')}] Festival Style`;

    const body = (
      `Herzlich Willkommen bei ${cfg.shopName || 'unserem Store'}!\n\n` +
      `Zum Verkauf steht:\n` +
      `Artikel: ${product.name}\n` +
      `Kategorie: ${product.category || 'Fashion'}\n` +
      `Zustand: NEU mit Etikett\n\n` +
      `BESCHREIBUNG:\n` +
      `${product.description || 'Hochwertige Qualität, optimal für Festivals und Alltag.'}\n\n` +
      `DETAILS & GRÖSSEN:\n` +
      `• Verfügbare Größen: ${(product.sizes || []).join(', ')}\n` +
      `• Lagerbestand: Sofort lieferbar (${product.stock} Stück auf Lager)\n\n` +
      `VERSAND & ZAHLUNG:\n` +
      `• Versicherter DHL-Versand inkl. Trackingnummer am selben Werktag\n` +
      `• Zahlungsmöglichkeiten: PayPal Käuferschutz, Überweisung\n` +
      `• Schneller Support via WhatsApp: ${cfg.whatsappNumber || 'Auf Anfrage'}\n\n` +
      `Rechnung mit ausgewiesener MwSt. liegt jeder Sendung bei.`
    );

    return { title, price, body };
  }

  /**
   * Generiert Telegram Channel Postings (mit Emojis & Direkt-Bestelllink)
   */
  generateTelegramDropPost(product) {
    const cfg = this.getConfig();
    const price = Number(product.price || 0).toFixed(2);
    const waLink = cfg.whatsappNumber
      ? `https://wa.me/${cfg.whatsappNumber.replace(/[^0-9]/g, '')}?text=${encodeURIComponent('Hi, ich möchte "' + product.name + '" für ' + price + ' € bestellen!')}`
      : '#';

    return (
      `🚨 *NEW DROP: ${product.name.toUpperCase()}* 🚨\n\n` +
      `⚡ *Kategorie:* ${product.category || 'Festival'}\n` +
      `🔥 *Preis:* ${price} €\n` +
      `📏 *Größen:* ${(product.sizes || []).join(' | ')}\n` +
      `📦 *Lagerbestand:* ${product.stock}x sofort versandbereit!\n\n` +
      `${product.description || ''}\n\n` +
      `🚚 Schneller DHL Express Versand\n\n` +
      `👉 [Jetzt direkt per WhatsApp bestellen](${waLink})`
    );
  }

  /**
   * Generiert Google Shopping XML Feed (RSS 2.0 / Google Merchant Center)
   */
  generateGoogleShoppingXml(baseUrl = 'http://localhost:8080') {
    const products = this.catalogManager.getAll({ activeOnly: true });
    const cfg = this.getConfig();

    const itemsXml = products.map(p => {
      const price = Number(p.price || 0).toFixed(2);
      const link = `${baseUrl}/#p=${encodeURIComponent(p.id)}`;
      const img = p.image || (p.images && p.images[0]) || `${baseUrl}/images/${p.id}.jpg`;
      const desc = (p.description || p.name).replace(/[<>&"']/g, '');

      return `    <item>
      <g:id>${p.id}</g:id>
      <g:title><![CDATA[${p.name}]]></g:title>
      <g:description><![CDATA[${desc}]]></g:description>
      <g:link>${link}</g:link>
      <g:image_link>${img}</g:image_link>
      <g:condition>new</g:condition>
      <g:availability>${p.stock > 0 ? 'in_stock' : 'out_of_stock'}</g:availability>
      <g:price>${price} EUR</g:price>
      <g:brand><![CDATA[${p.brand || cfg.shopName || 'Uptempo'}]]></g:brand>
      <g:identifier_exists>no</g:identifier_exists>
    </item>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
  <channel>
    <title><![CDATA[${cfg.shopName || 'WaWi Store'}]]></title>
    <link>${baseUrl}</link>
    <description><![CDATA[Offizieller Produktkatalog für Google Shopping & Meta]]></description>
${itemsXml}
  </channel>
</rss>`;
  }

  /**
   * Generiert EPC-QR String (GiroCode) für Banking-Apps nach SEPA-Standard
   */
  generateGiroCodeString(order) {
    const cfg = this.getConfig();
    if (!cfg.bankIban) return '';

    const iban = (cfg.bankIban || '').replace(/\s/g, '').toUpperCase();
    const bic = (cfg.bankBic || '').replace(/\s/g, '').toUpperCase();
    const name = (cfg.bankHolder || 'David Puchalla').slice(0, 70);
    const amount = Number(order.total || 0).toFixed(2);
    const ref = `Bestellung ${order.id}`.slice(0, 35);

    // SEPA EPC069-08 Standard
    return (
      `BCD\n` +
      `002\n` +
      `1\n` +
      `SCT\n` +
      `${bic}\n` +
      `${name}\n` +
      `${iban}\n` +
      `EUR${amount}\n` +
      `\n` +
      `\n` +
      `${ref}\n`
    );
  }

  /**
   * Exportiert Produkte als CSV Feed
   */
  exportProductsCsv() {
    const products = this.catalogManager.getAll({ activeOnly: true });
    const header = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand'];
    const rows = products.map(p => [
      `"${p.id}"`,
      `"${(p.name || '').replace(/"/g, '""')}"`,
      `"${(p.description || '').replace(/"/g, '""')}"`,
      p.stock > 0 ? 'in stock' : 'out of stock',
      'new',
      `${(p.price || 0).toFixed(2)} EUR`,
      `"/?p=${encodeURIComponent(p.id)}"`,
      `"${(p.image || (p.images && p.images[0]) || '')}"`,
      `"${(p.brand || '').replace(/"/g, '""')}"`,
    ]);

    return [header.join(','), ...rows.map(r => r.join(','))].join('\n');
  }
}

module.exports = { ChannelsManager };
