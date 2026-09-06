'use strict';
/**
 * WaWi Order Management Module
 * Verwaltet den kompletten Lebenszyklus von Kundenbestellungen mit lückenlosem Audit-Trail.
 */

const fs = require('fs');
const { logger } = require('./logger');

class OrderManager {
  constructor(ordersFilePath, catalogManager = null) {
    this.ordersFilePath = ordersFilePath;
    this.catalogManager = catalogManager;
  }

  loadOrders() {
    try {
      if (!fs.existsSync(this.ordersFilePath)) {
        return [];
      }
      const raw = fs.readFileSync(this.ordersFilePath, 'utf8');
      const data = JSON.parse(raw);
      return Array.isArray(data.orders) ? data.orders : (Array.isArray(data) ? data : []);
    } catch (err) {
      logger.error('ORDERS', `Fehler beim Laden von ${this.ordersFilePath}: ${err.message}`);
      return [];
    }
  }

  saveOrders(orders) {
    const tmp = this.ordersFilePath + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ orders }, null, 2), 'utf8');
    fs.renameSync(tmp, this.ordersFilePath);
    logger.debug('ORDERS', `Bestelldatenbank atomar aktualisiert (${orders.length} Bestellungen)`);
  }

  getAll(filter = {}) {
    let list = this.loadOrders();
    if (filter.status) {
      list = list.filter(o => o.status === filter.status);
    }
    if (filter.search) {
      const q = filter.search.toLowerCase();
      list = list.filter(o =>
        (o.id && o.id.toLowerCase().includes(q)) ||
        (o.customer && o.customer.name && o.customer.name.toLowerCase().includes(q)) ||
        (o.customer && o.customer.email && o.customer.email.toLowerCase().includes(q)) ||
        (o.trackingNumber && o.trackingNumber.toLowerCase().includes(q))
      );
    }
    return list.sort((a, b) => new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0));
  }

  getById(id) {
    const list = this.loadOrders();
    return list.find(o => o.id === id) || null;
  }

  createOrder(orderData) {
    const list = this.loadOrders();
    const now = new Date().toISOString();
    const id = orderData.id || 'ORD-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substr(2, 4).toUpperCase();

    const order = {
      id,
      date: orderData.date || orderData.createdAt || now,
      customer: {
        name: (orderData.customer && orderData.customer.name) || '',
        email: (orderData.customer && orderData.customer.email) || '',
        phone: (orderData.customer && orderData.customer.phone) || '',
        street: (orderData.customer && (orderData.customer.street || orderData.customer.address)) || '',
        zip: (orderData.customer && orderData.customer.zip) || '',
        city: (orderData.customer && orderData.customer.city) || '',
        note: (orderData.customer && orderData.customer.note) || '',
      },
      items: Array.isArray(orderData.items) ? orderData.items : [],
      total: typeof orderData.total === 'number' ? orderData.total : 0,
      status: orderData.status || 'NEU',
      tracking: orderData.tracking || null,
      trackingNumber: orderData.trackingNumber || '',
      carrier: orderData.carrier || 'DHL',
      trackingUrl: orderData.trackingUrl || '',
      paymentMethod: orderData.paymentMethod || 'vorkasse',
      notes: orderData.notes || '',
      updatedAt: now,
    };

    if (this.catalogManager && Array.isArray(order.items)) {
      for (const item of order.items) {
        if (item.productId && item.quantity) {
          this.catalogManager.adjustStock(item.productId, item.size, -item.quantity);
        }
      }
    }

    list.unshift(order);
    this.saveOrders(list);

    logger.audit('ORDERS', `Neue Bestellung eingegangen: ${order.id} von ${order.customer.name} (Summe: ${order.total.toFixed(2)} EUR)`, {
      orderId: order.id,
      customer: order.customer.email,
      total: order.total,
      itemsCount: order.items.length,
    });

    return order;
  }

  updateStatus(id, newStatus, notes = '') {
    const list = this.loadOrders();
    const order = list.find(o => o.id === id);
    if (!order) {
      logger.warn('ORDERS', `Status-Änderung fehlgeschlagen: Bestellung ${id} nicht gefunden`);
      return null;
    }

    const oldStatus = order.status;
    order.status = newStatus;
    order.updated = new Date().toISOString();
    if (notes) {
      order.notes = (order.notes ? order.notes + '\n' : '') + `[${newStatus}] ${notes}`;
    }

    if (newStatus === 'STORNIERT' && oldStatus !== 'STORNIERT' && this.catalogManager && Array.isArray(order.items)) {
      for (const item of order.items) {
        if (item.productId && item.quantity) {
          this.catalogManager.adjustStock(item.productId, item.size, item.quantity);
        }
      }
    }

    this.saveOrders(list);
    logger.audit('ORDERS', `Bestellstatus geändert für ${id}: ${oldStatus} -> ${newStatus}`, {
      orderId: id,
      oldStatus,
      newStatus,
    });
    return order;
  }

  setTracking(id, trackingNumber, carrier = 'DHL') {
    const list = this.loadOrders();
    const order = list.find(o => o.id === id);
    if (!order) {
      logger.warn('ORDERS', `Tracking-Zuweisung fehlgeschlagen: Bestellung ${id} nicht gefunden`);
      return null;
    }

    const num = (trackingNumber || '').trim();
    order.trackingNumber = num;
    order.carrier = carrier;

    if (carrier.toUpperCase() === 'DHL' && num) {
      order.trackingUrl = `https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=${encodeURIComponent(num)}`;
      order.tracking = {
        carrier: 'DHL',
        number: num,
        url: order.trackingUrl,
        at: new Date().toISOString(),
      };
    }

    if (num && (order.status === 'NEU' || order.status === 'BEZAHLT')) {
      order.status = 'VERSENDET';
    }

    order.shippedAt = new Date().toISOString();
    order.updated = new Date().toISOString();
    this.saveOrders(list);

    logger.audit('FULFILLMENT', `DHL-Tracking hinterlegt für ${id}: ${num} (${order.trackingUrl})`, {
      orderId: id,
      trackingNumber: num,
      carrier,
    });

    return order;
  }
}

module.exports = { OrderManager };
