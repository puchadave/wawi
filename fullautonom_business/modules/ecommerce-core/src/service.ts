import { z } from 'zod';
import { NicheProduct, ProductVariant, ProductPricing, SeoData, DomainEvent, createDomainEvent } from '@fullautonom/shared';

// ============================================================================
// Zod Schemas
// ============================================================================

export const ProductCreateSchema = z.object({
  title: z.string(),
  description: z.string(),
  brand: z.string().optional(),
  category: z.string(),
  subcategory: z.string(),
  genres: z.array(z.string()),
  images: z.array(z.string()).default([]),
  variants: z.array(z.object({
    name: z.string(),
    sku: z.string(),
    ean: z.string().optional(),
    stock: z.number(),
    attributes: z.record(z.string()).default({}),
  })),
  supplierNet: z.number().positive(),
  dropshipFee: z.number().default(0),
  freightCost: z.number().default(0),
  margin: z.number().default(0.4),
  supplierIds: z.array(z.string()).default([]),
});

export const SyncRequestSchema = z.object({
  productId: z.string(),
});

export const OrderProcessSchema = z.object({
  orderId: z.string(),
  items: z.array(z.object({
    productId: z.string(),
    variantId: z.string(),
    quantity: z.number(),
  })),
  total: z.number(),
  customerId: z.string(),
});

// ============================================================================
// Ecommerce Core Service
// ============================================================================

export class EcommerceCoreService {
  private products: NicheProduct[] = [];
  private orders: Array<Record<string, unknown>> = [];
  private eventEmitter: (event: DomainEvent) => Promise<void> = async () => {};

  setEventEmitter(emitter: (event: DomainEvent) => Promise<void>) {
    this.eventEmitter = emitter;
  }

  createProduct(data: z.infer<typeof ProductCreateSchema>): NicheProduct {
    const pricing = this.calculatePricing(data);
    const product: NicheProduct = {
      id: crypto.randomUUID(),
      title: data.title,
      description: data.description,
      brand: data.brand ?? '',
      category: data.category,
      subcategory: data.subcategory,
      genres: data.genres,
      images: data.images,
      variants: data.variants as ProductVariant[],
      pricing,
      seo: this.generateSeo(data),
      status: 'draft',
      supplierIds: data.supplierIds,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.products.push(product);
    return product;
  }

  private calculatePricing(data: z.infer<typeof ProductCreateSchema>): ProductPricing {
    const { supplierNet, dropshipFee, freightCost, margin } = data;
    const shopEkNet = supplierNet + dropshipFee + freightCost;
    const shopVkNet = shopEkNet / (1 - margin);
    const shopVkGross = shopVkNet * 1.19;
    const uvp = Math.ceil(shopVkGross * 1.2 / 0.1) * 0.1 - 0.01;

    return {
      supplierNet,
      dropshipFee,
      freightCost,
      shopEkNet,
      shopVkNet,
      shopVkGross,
      margin: margin * 100,
      uvp,
      currency: 'EUR',
    };
  }

  private generateSeo(data: z.infer<typeof ProductCreateSchema>): SeoData {
    const slug = data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return {
      metaTitle: `${data.title} | ${data.brand ?? 'Nischenshop'}`,
      metaDescription: `${data.title} für ${data.genres.join(', ')} Fans. Sweatproof, langlebig, einzigartig.`,
      focusKeyword: `${data.genres[0]} ${data.subcategory}`,
      slug,
    };
  }

  async syncToShopware(productId: string): Promise<{ success: boolean; shopwareId: string }> {
    const product = this.products.find(p => p.id === productId);
    if (!product) throw new Error(`Product ${productId} not found`);
    product.status = 'active';
    product.shopwareId = `sw-${productId}`;
    await this.eventEmitter(createDomainEvent('product.updated', 'ecommerce-core', { productId, shopwareId: product.shopwareId }));
    return { success: true, shopwareId: product.shopwareId };
  }

  async processOrder(orderData: z.infer<typeof OrderProcessSchema>): Promise<void> {
    this.orders.push({ ...orderData, processedAt: new Date(), status: 'pending' });
    await this.eventEmitter(createDomainEvent('order.created', 'ecommerce-core', orderData));
  }

  getProducts(filters?: { status?: string; genre?: string }): NicheProduct[] {
    let products = this.products;
    if (filters?.status) products = products.filter(p => p.status === filters.status);
    if (filters?.genre) products = products.filter(p => p.genres.includes(filters.genre!));
    return products;
  }

  getOrders(): Array<Record<string, unknown>> {
    return this.orders;
  }

  getProduct(id: string): NicheProduct | undefined {
    return this.products.find(p => p.id === id);
  }
}