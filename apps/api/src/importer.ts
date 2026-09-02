import { MatterhornProduct, MatterhornOption } from '@wawi/shared';
import { db } from './db.js';
import { products, variants } from './schema.js';
import { eq } from 'drizzle-orm';

export async function upsertProduct(product: MatterhornProduct, forceWhitelist = false) {
  const productId = String(product.id);

  // 1. Prüfe ob Whitelisted oder bereits vorhanden
  const existing = await db.select({ isWhitelisted: products.isWhitelisted })
    .from(products)
    .where(eq(products.supplierProductId, productId))
    .limit(1);

  const isWhitelisted = forceWhitelist || (existing.length > 0 && existing[0].isWhitelisted);

  // Wenn nicht Whitelisted und kein Whitelist-Import → SKIP
  if (!isWhitelisted) {
    // console.log(`Skipping non-whitelisted product ${productId}`);
    return;
  }

  const safeName = (product.name || 'Unbekanntes Produkt').trim();
  const safeBrand = (product.brand || 'Unbekannte Marke').trim();
  const safeCategoryPath = (product.categoryPath || '/').trim();
  const safeCategoryId = (product.categoryId || '0').trim();

  await db.insert(products).values({
    supplierProductId: productId,
    name: safeName,
    brand: safeBrand,
    categoryPath: safeCategoryPath,
    categoryId: safeCategoryId,
    color: product.color || null,
    type: product.type || null,
    descriptionHtml: product.descriptionHtml || '',
    images: product.images || [],
    prices: product.prices || {},
    isWhitelisted,
    status: 'imported',
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: products.supplierProductId,
    set: {
      name: safeName,
      brand: safeBrand,
      categoryPath: safeCategoryPath,
      categoryId: safeCategoryId,
      color: product.color || null,
      type: product.type || null,
      descriptionHtml: product.descriptionHtml || '',
      images: product.images || [],
      prices: product.prices || {},
      isWhitelisted,
      updatedAt: new Date(),
    },
  });

  if (product.options && product.options.length > 0) {
    for (const opt of product.options) {
      if (!opt.id) continue;
      const variantId = String(opt.id);
      await db.insert(variants).values({
        supplierVariantId: variantId,
        supplierProductId: productId,
        name: opt.name || 'Standard',
        stock: opt.stock || 0,
        availableIn: opt.availableIn || 0,
        ean: opt.ean || null,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: variants.supplierVariantId,
        set: {
          name: opt.name || 'Standard',
          stock: opt.stock || 0,
          availableIn: opt.availableIn || 0,
          ean: opt.ean || null,
          updatedAt: new Date(),
        },
      });
    }
  }
}
