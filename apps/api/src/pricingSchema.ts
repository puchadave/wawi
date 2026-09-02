import { pgTable, text, timestamp, integer, decimal, boolean } from 'drizzle-orm/pg-core';
import { products } from './schema';

export const priceRules = pgTable('price_rules', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  vatRate: decimal('vat_rate', { precision: 5, scale: 4 }).default('0.1900').notNull(),
  targetMargin: decimal('target_margin', { precision: 5, scale: 4 }).default('0.4000').notNull(),
  fixedSurchargeNet: decimal('fixed_surcharge_net', { precision: 10, scale: 2 }).default('0.00').notNull(),
  mode: text('mode', { enum: ['netto', 'brutto'] }).default('brutto').notNull(),
  charmPricing: boolean('charm_pricing').default(true).notNull(),
  includeFreightInVk: boolean('include_freight_in_vk').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const shippingRates = pgTable('shipping_rates', {
  id: text('id').primaryKey(),
  countryCode: text('country_code').notNull(),
  carrier: text('carrier').notNull(),
  weightClass: text('weight_class').notNull(),
  netPrice: decimal('net_price', { precision: 10, scale: 2 }).notNull(),
  leadDays: integer('lead_days').default(2).notNull(),
  source: text('source', { enum: ['api', 'scrape'] }).default('api').notNull(),
  fetchedAt: timestamp('fetched_at').defaultNow().notNull(),
  sourceHash: text('source_hash'),
});

export const feeSchedule = pgTable('fee_schedule', {
  id: text('id').primaryKey(),
  feeType: text('fee_type').notNull(),
  amountNet: decimal('amount_net', { precision: 10, scale: 2 }).notNull(),
  sourceUrl: text('source_url'),
  sourceHash: text('source_hash'),
  validFrom: timestamp('valid_from').defaultNow().notNull(),
});

export const pricingAudit = pgTable('pricing_audit', {
  id: text('id').primaryKey(),
  productId: text('product_id').references(() => products.supplierProductId, { onDelete: 'cascade' }).notNull(),
  priceRuleId: text('price_rule_id').references(() => priceRules.id, { onDelete: 'cascade' }).notNull(),
  oldPriceNet: decimal('old_price_net', { precision: 10, scale: 2 }),
  newPriceNet: decimal('new_price_net', { precision: 10, scale: 2 }).notNull(),
  changedAt: timestamp('changed_at').defaultNow().notNull(),
  changedBy: text('changed_by').default('system').notNull(),
});