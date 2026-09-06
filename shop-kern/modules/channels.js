'use strict';
/**
 * WaWi Multi-Channel & Export Manager
 * Generiert optimierte Verkaufstexte und Exportdaten für WhatsApp, Facebook & Feeds.
 */

class ChannelsManager {
  constructor(catalogManager, configGetter) {
    this.catalogManager = catalogManager;
    this.getConfig = configGetter;
  }

  /**
   * Generiert eine strukturierte WhatsApp-Bestellnachricht für Kunden
   */
  generateWhatsAppOrderText(order) {
    const cfg = this.getConfig();
    const itemsList = (order.items || [])
      .map(it => `• ${it.quantity}x ${it.name}${it.size ? ' (Größe ' + it.size + ')' : ''} — ${(it.price * it.quantity).toFixed(2)} €`)
      .join('\n');

    return (
      `*Neue Bestellung über ${cfg.shopName || 'WaWi'}*\n\n` +
      `Bestell-Nr.: *${order.id}*\n` +
      `Kunde: ${order.customer.name}\n` +
      `E-Mail: ${order.customer.email}\n` +
      `Lieferadresse:\n${order.customer.address}\n\n` +
      `*Artikel:*\n${itemsList}\n\n` +
      `*Gesamtsumme: ${order.total.toFixed(2)} EUR*\n\n` +
      `Status: ${order.status}\n` +
      (order.trackingNumber ? `DHL-Tracking: ${order.trackingNumber}\n${order.trackingUrl}\n` : '')
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
      `• Marke: ${product.brand || 'Markenware'}\n` +
      `• Verfügbare Größen: ${sizes}\n` +
      `• Zustand: Neu mit Etikett\n` +
      `• Preis: ${priceFormatted} €\n` +
      `• Schneller Versand via DHL mit Tracking\n\n` +
      `Bei Interesse einfach Nachricht schreiben oder direkt über WhatsApp bestellen!\n` +
      `Shop: ${cfg.shopName || 'Online Store'}`
    );

    return {
      title,
      price: priceFormatted,
      category: product.category || 'Kleidung & Schuhe',
      description,
      sku: product.sku || product.id,
      images: product.images || (product.image ? [product.image] : []),
    };
  }

  /**
   * Exportiert aktive Produkte als CSV für Feeds / Kataloge
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
