'use strict';

const { logger } = require('./logger');

class AnalyticsEngine {
  constructor(catalogManager, orderManager) {
    this.catalogManager = catalogManager;
    this.orderManager = orderManager;
    logger.info('ANALYTICS', 'AnalyticsEngine initialisiert.');
  }

  /**
   * Ermittelt die Top-Produkte basierend auf verschiedenen Kriterien.
   * @param {number} count - Die Anzahl der Top-Produkte, die zurückgegeben werden sollen.
   * @param {string} criteria - Das Kriterium für die Sortierung (z.B. 'revenue', 'margin').
   * @returns {Array<object>} Eine Liste der Top-Produkte.
   */
  getTopProducts(count = 10, criteria = 'revenue') {
    logger.debug('ANALYTICS', `Ermittlung der Top ${count} Produkte nach Kriterium '${criteria}'`);
    const allProducts = this.catalogManager.loadProducts();
    const allOrders = this.orderManager.loadOrders();

    const productStats = {};

    // Initialisiere Statistiken für jedes Produkt
    allProducts.forEach(p => {
      productStats[p.id] = {
        ...p,
        totalRevenue: 0,
        totalMargin: 0,
        orderCount: 0,
      };
    });

    // Aggregiere Daten aus Bestellungen
    allOrders.forEach(order => {
      order.items.forEach(item => {
        const productId = item.productId;
        if (productStats[productId]) {
          productStats[productId].totalRevenue += item.quantity * item.price;
          // Annahme: Marge wird pro Produkt in catalogManager berechnet oder in Produktdaten gespeichert
          // Für diesen Prototypen nehmen wir eine einfache Marge an, oder holen sie vom Produkt selbst
          const productData = this.catalogManager.getById(productId);
          if (productData && productData.calculatedPrice && productData.calculatedPrice.marginAmountNet) {
            productStats[productId].totalMargin += item.quantity * productData.calculatedPrice.marginAmountNet;
          } else {
             // Fallback für Marge, falls nicht direkt verfügbar oder berechnet
             // Hier könnte eine Default-Marge oder eine Berechnung basierend auf EK/VK erfolgen
             productStats[productId].totalMargin += item.quantity * (item.price * 0.2); // Beispiel: 20% Marge
          }
          productStats[productId].orderCount += item.quantity;
        }
      });
    });

    // Konvertiere zu einem Array und sortiere
    let sortedProducts = Object.values(productStats);

    if (criteria === 'revenue') {
      sortedProducts.sort((a, b) => b.totalRevenue - a.totalRevenue);
    } else if (criteria === 'margin') {
      sortedProducts.sort((a, b) => b.totalMargin - a.totalMargin);
    } else if (criteria === 'orderCount') {
        sortedProducts.sort((a, b) => b.orderCount - a.orderCount);
    } else {
        logger.warn('ANALYTICS', `Unbekanntes Kriterium '${criteria}'. Sortiere nach 'revenue'.`);
        sortedProducts.sort((a, b) => b.totalRevenue - a.totalRevenue);
    }

    logger.debug('ANALYTICS', `Top Produkte erfolgreich ermittelt: ${sortedProducts.slice(0, count).map(p => p.name).join(', ')}`);
    return sortedProducts.slice(0, count);
  }
}

module.exports = { AnalyticsEngine };
