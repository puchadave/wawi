import { z } from 'zod';
import { Supplier, SupplierOrder, OrderItem, ShippingRate, DomainEvent, createDomainEvent } from '@fullautonom/shared';

// ============================================================================
// Zod Schemas
// ============================================================================

export const SupplierSchema = z.object({
  name: z.string(),
  apiEndpoint: z.string().optional(),
  apiKey: z.string().optional(),
  type: z.enum(['api', 'xml', 'csv', 'manual', 'matterhorn']),
  industries: z.array(z.string()),
  leadTimeDays: z.number().min(1),
  shippingZones: z.array(z.string()),
  returnPolicy: z.string(),
  paymentTerms: z.string(),
  reliabilityScore: z.number().min(0).max(1).default(0.5),
});

export const SupplierOrderSchema = z.object({
  supplierId: z.string(),
  orderId: z.string(),
  items: z.array(z.object({
    productId: z.string(),
    variantId: z.string(),
    quantity: z.number().min(1),
    unitPrice: z.number().positive(),
    ean: z.string().optional(),
  })),
  totalAmount: z.number().positive(),
});

export const ReturnSchema = z.object({
  orderId: z.string(),
  reason: z.string(),
  items: z.array(z.object({
    productId: z.string(),
    variantId: z.string(),
    quantity: z.number(),
  })),
});

// ============================================================================
// Logistics Hub Service
// ============================================================================

export class LogisticsHubService {
  private suppliers: Supplier[] = [];
  private supplierOrders: SupplierOrder[] = [];
  private shippingRates: ShippingRate[] = [
    { carrier: 'DHL', zone: 'DE', weightClass: '0-1kg', price: 4.99, leadDays: 1 },
    { carrier: 'DHL', zone: 'DE', weightClass: '1-5kg', price: 6.99, leadDays: 2 },
    { carrier: 'Hermes', zone: 'DE', weightClass: '0-1kg', price: 3.99, leadDays: 2 },
    { carrier: 'DPD', zone: 'EU', weightClass: '0-2kg', price: 8.99, leadDays: 3 },
  ];
  private eventEmitter: (event: DomainEvent) => Promise<void> = async () => {};

  setEventEmitter(emitter: (event: DomainEvent) => Promise<void>) {
    this.eventEmitter = emitter;
  }

  registerSupplier(data: z.infer<typeof SupplierSchema>): Supplier {
    const supplier: Supplier = {
      id: crypto.randomUUID(),
      ...data,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.suppliers.push(supplier);
    return supplier;
  }

  selectBestSupplier(filters: {
    industries?: string[];
    maxLeadTimeDays?: number;
    zone?: string;
  } = {}): Supplier | null {
    let candidates = this.suppliers.filter(s => s.isActive && s.reliabilityScore > 0.3);
    if (filters.industries?.length) {
      candidates = candidates.filter(s => s.industries.some(i => filters.industries!.includes(i)));
    }
    if (filters.maxLeadTimeDays) {
      candidates = candidates.filter(s => s.leadTimeDays <= filters.maxLeadTimeDays!);
    }
    if (filters.zone) {
      candidates = candidates.filter(s => s.shippingZones.includes(filters.zone!));
    }
    if (candidates.length === 0) return null;

    return candidates.sort((a, b) => {
      const aScore = a.reliabilityScore / Math.max(a.leadTimeDays, 1);
      const bScore = b.reliabilityScore / Math.max(b.leadTimeDays, 1);
      return bScore - aScore;
    })[0];
  }

  async createOrderFromCustomer(
    shopwareOrder: OrderItem[],
    totalCustomerPaid: number,
    preferredIndustries?: string[]
  ): Promise<SupplierOrder> {
    const supplier = this.selectBestSupplier({
      industries: preferredIndustries,
      maxLeadTimeDays: 3,
    });
    if (!supplier) throw new Error('No suitable supplier available');

    const order: SupplierOrder = {
      id: crypto.randomUUID(),
      supplierId: supplier.id,
      orderId: `SUP-${Date.now()}`,
      items: shopwareOrder,
      totalAmount: roundToCents(totalCustomerPaid * 0.6),
      status: 'pending',
      estimatedDelivery: new Date(Date.now() + supplier.leadTimeDays * 86400000),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.supplierOrders.push(order);
    await this.eventEmitter(createDomainEvent('logistics.supplier_order_created', 'logistics-hub', { orderId: order.id, supplierId: supplier.id }));
    return order;
  }

  trackOrder(orderId: string): SupplierOrder | undefined {
    return this.supplierOrders.find(o => o.id === orderId);
  }

  updateOrderStatus(orderId: string, status: SupplierOrder['status'], trackingNumber?: string, trackingUrl?: string): SupplierOrder {
    const order = this.supplierOrders.find(o => o.id === orderId);
    if (!order) throw new Error(`Order ${orderId} not found`);
    order.status = status;
    order.trackingNumber = trackingNumber;
    order.trackingUrl = trackingUrl;
    if (status === 'delivered') order.actualDelivery = new Date();
    order.updatedAt = new Date();
    
    if (status === 'shipped') {
      this.eventEmitter(createDomainEvent('logistics.supplier_order_shipped', 'logistics-hub', { orderId }));
    }
    return order;
  }

  async processReturn(data: z.infer<typeof ReturnSchema>): Promise<SupplierOrder> {
    const order = this.supplierOrders.find(o => o.id === data.orderId);
    if (!order) throw new Error(`Order ${data.orderId} not found`);
    order.status = 'returned';
    order.updatedAt = new Date();
    await this.eventEmitter(createDomainEvent('logistics.return_received', 'logistics-hub', { orderId: order.id, reason: data.reason }));
    return order;
  }

  getSuppliers(): Supplier[] {
    return this.suppliers.filter(s => s.isActive);
  }

  getAllSuppliers(): Supplier[] {
    return this.suppliers;
  }

  getShippingRates(): ShippingRate[] {
    return this.shippingRates;
  }

  addShippingRate(rate: ShippingRate): ShippingRate {
    this.shippingRates.push(rate);
    return rate;
  }
}

function roundToCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}