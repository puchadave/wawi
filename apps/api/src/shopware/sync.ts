import { createHash } from 'crypto';
import { v5 as uuidv5 } from 'uuid';
import { db } from '../db.js';
import { products, shopwareMappings, syncAttempts, syncHashes, variants } from '../schema.js';
import { and, eq } from 'drizzle-orm';
import { shopwareClient } from './client.js';

const SHOPWARE_NAMESPACE = '4ba8c82f-ec90-5d5c-a887-2f393655d606';
const DEFAULT_TAX_ID = '01900000000000000000000000000001';
const DEFAULT_CURRENCY_ID = 'b7d2554b0ce847cd82f3ac9bd1c0dfca';

export interface ShopwareSyncJobData {
  supplierProductId: string;
  attemptId: string;
}

function stableHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function shopwareId(key: string) {
  return uuidv5(key, SHOPWARE_NAMESPACE).replaceAll('-', '');
}

function effectiveContent(product: typeof products.$inferSelect) {
  return {
    name: product.manualData.title ?? product.aiData.title ?? product.name,
    description: product.manualData.description ?? product.aiData.description ?? product.descriptionHtml ?? '',
    metaTitle: product.manualData.metaTitle ?? product.aiData.metaTitle ?? null,
    metaDescription: product.manualData.metaDescription ?? product.aiData.metaDescription ?? null,
  };
}

export async function syncProductToShopware(data: ShopwareSyncJobData, jobId?: string) {
  await db.update(syncAttempts)
    .set({ status: 'running', jobId: jobId || null, startedAt: new Date(), updatedAt: new Date(), error: null })
    .where(eq(syncAttempts.id, data.attemptId));

  try {
    const [productRows, productVariants, hashRows] = await Promise.all([
      db.select().from(products).where(eq(products.supplierProductId, data.supplierProductId)).limit(1),
      db.select().from(variants).where(eq(variants.supplierProductId, data.supplierProductId)),
      db.select().from(syncHashes).where(eq(syncHashes.supplierProductId, data.supplierProductId)).limit(1),
    ]);

    const product = productRows[0];
    if (!product) throw new Error('Product not found');
    if (product.status !== 'approved' && product.status !== 'synced') {
      throw new Error(`Product must be approved before sync (current status: ${product.status})`);
    }

    const content = effectiveContent(product);
    const supplierHash = stableHash({
      name: product.name,
      brand: product.brand,
      categoryPath: product.categoryPath,
      categoryId: product.categoryId,
      color: product.color,
      type: product.type,
    });
    const pricingHash = stableHash(product.prices);
    const stockHash = stableHash(productVariants.map(({ supplierVariantId, stock, availableIn }) => ({ supplierVariantId, stock, availableIn })));
    const imageHash = stableHash(product.images);
    const contentHash = stableHash(content);
    const previousHashes = hashRows[0];
    const unchanged = previousHashes?.supplierHash === supplierHash
      && previousHashes.pricingHash === pricingHash
      && previousHashes.stockHash === stockHash
      && previousHashes.imageHash === imageHash
      && previousHashes.contentHash === contentHash;

    if (unchanged && product.status === 'synced') {
      await db.update(syncAttempts)
        .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
        .where(eq(syncAttempts.id, data.attemptId));
      return { supplierProductId: product.supplierProductId, skipped: true };
    }

    const productId = shopwareId(`product:${product.supplierProductId}`);
    const price = product.prices.EUR || 0;
    const childPayload = productVariants.map((variant) => ({
      id: shopwareId(`variant:${variant.supplierVariantId}`),
      parentId: productId,
      productNumber: variant.supplierVariantId,
      stock: variant.stock,
      active: variant.stock > 0,
      name: `${content.name} ${variant.name}`,
      ean: variant.ean || undefined,
      customFields: {
        matterhorn_variant_id: variant.supplierVariantId,
        matterhorn_available_in: variant.availableIn,
      },
    }));

    const payload = {
      'product-upsert': {
        entity: 'product',
        action: 'upsert',
        payload: [{
          id: productId,
          productNumber: product.supplierProductId,
          name: content.name,
          description: content.description,
          metaTitle: content.metaTitle,
          metaDescription: content.metaDescription,
          stock: productVariants.reduce((total, variant) => total + variant.stock, 0),
          active: product.isWhitelisted,
          taxId: process.env.SHOPWARE_TAX_ID || DEFAULT_TAX_ID,
          price: [{
            currencyId: process.env.SHOPWARE_CURRENCY_ID || DEFAULT_CURRENCY_ID,
            net: price,
            gross: Math.round(price * 1.19 * 100) / 100,
            linked: true,
          }],
          customFields: {
            matterhorn_product_id: product.supplierProductId,
            matterhorn_brand: product.brand,
            matterhorn_category_path: product.categoryPath,
            matterhorn_color: product.color,
            matterhorn_type: product.type,
            matterhorn_images: product.images,
          },
          children: childPayload,
        }],
      },
    };

    await shopwareClient.sync(payload);

    await db.transaction(async (tx) => {
      await tx.insert(shopwareMappings).values({
        id: `product:${product.supplierProductId}`,
        supplierProductId: product.supplierProductId,
        supplierVariantId: null,
        shopwareUuid: productId,
        entityType: 'product',
        syncedAt: new Date(),
      }).onConflictDoUpdate({
        target: shopwareMappings.id,
        set: { shopwareUuid: productId, syncedAt: new Date() },
      });

      for (const variant of productVariants) {
        const variantId = shopwareId(`variant:${variant.supplierVariantId}`);
        await tx.insert(shopwareMappings).values({
          id: `variant:${variant.supplierVariantId}`,
          supplierProductId: product.supplierProductId,
          supplierVariantId: variant.supplierVariantId,
          shopwareUuid: variantId,
          entityType: 'variant',
          syncedAt: new Date(),
        }).onConflictDoUpdate({
          target: shopwareMappings.id,
          set: { shopwareUuid: variantId, syncedAt: new Date() },
        });
      }

      await tx.insert(syncHashes).values({
        supplierProductId: product.supplierProductId,
        supplierHash,
        pricingHash,
        stockHash,
        imageHash,
        contentHash,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: syncHashes.supplierProductId,
        set: { supplierHash, pricingHash, stockHash, imageHash, contentHash, updatedAt: new Date() },
      });

      await tx.update(products)
        .set({ status: 'synced', updatedAt: new Date() })
        .where(eq(products.supplierProductId, product.supplierProductId));

      await tx.update(syncAttempts)
        .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date(), error: null })
        .where(eq(syncAttempts.id, data.attemptId));
    });

    return { supplierProductId: product.supplierProductId, shopwareProductId: productId, skipped: false };
  } catch (error) {
    await db.update(syncAttempts)
      .set({ status: 'failed', completedAt: new Date(), updatedAt: new Date(), error: error instanceof Error ? error.message : String(error) })
      .where(and(eq(syncAttempts.id, data.attemptId), eq(syncAttempts.supplierProductId, data.supplierProductId)));
    throw error;
  }
}
