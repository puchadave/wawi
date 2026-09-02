import { pgTable, text, timestamp, integer, jsonb, decimal, boolean, uniqueIndex } from 'drizzle-orm/pg-core';

export const products = pgTable('products', {
  supplierProductId: text('supplier_product_id').primaryKey(),
  name: text('name').notNull(),
  brand: text('brand').notNull(),
  categoryPath: text('category_path').notNull(),
  categoryId: text('category_id').notNull(),
  color: text('color'),
  type: text('type'),
  descriptionHtml: text('description_html'),
  images: jsonb('images').$type<string[]>().default([]).notNull(),
  prices: jsonb('prices').$type<Record<string, number>>().default({}).notNull(),
  aiData: jsonb('ai_data').$type<Partial<{ title: string; description: string; metaTitle: string; metaDescription: string }>>().default({}).notNull(),
  manualData: jsonb('manual_data').$type<Partial<{ title: string; description: string; metaTitle: string; metaDescription: string }>>().default({}).notNull(),
  status: text('status', { enum: ['imported', 'reviewed', 'approved', 'synced', 'rejected'] }).default('imported').notNull(),
  isWhitelisted: boolean('is_whitelisted').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const variants = pgTable('variants', {
  supplierVariantId: text('supplier_variant_id').primaryKey(),
  supplierProductId: text('supplier_product_id').references(() => products.supplierProductId, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  stock: integer('stock').default(0).notNull(),
  availableIn: integer('available_in').default(0).notNull(),
  ean: text('ean'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const shopwareMappings = pgTable('shopware_mappings', {
  id: text('id').primaryKey(),
  supplierProductId: text('supplier_product_id').references(() => products.supplierProductId, { onDelete: 'cascade' }).notNull(),
  supplierVariantId: text('supplier_variant_id'),
  shopwareUuid: text('shopware_uuid').notNull(),
  entityType: text('entity_type', { enum: ['product', 'variant', 'category', 'property', 'media'] }).notNull(),
  syncedAt: timestamp('synced_at').defaultNow().notNull(),
});

export const syncHashes = pgTable('sync_hashes', {
  supplierProductId: text('supplier_product_id').primaryKey().references(() => products.supplierProductId, { onDelete: 'cascade' }),
  supplierHash: text('supplier_hash'),
  pricingHash: text('pricing_hash'),
  stockHash: text('stock_hash'),
  imageHash: text('image_hash'),
  contentHash: text('content_hash'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const syncAttempts = pgTable('sync_attempts', {
  id: text('id').primaryKey(),
  supplierProductId: text('supplier_product_id').references(() => products.supplierProductId, { onDelete: 'cascade' }).notNull(),
  jobId: text('job_id'),
  status: text('status', { enum: ['queued', 'running', 'completed', 'failed'] }).notNull(),
  error: text('error'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// --- User Management & Security ---

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name'),
  isActive: boolean('is_active').default(true).notNull(),
  isBootstrapAdmin: boolean('is_bootstrap_admin').default(false).notNull(),
  lastLoginAt: timestamp('last_login_at'),
  passwordChangedAt: timestamp('password_changed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const roles = pgTable('roles', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  isSystem: boolean('is_system').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const permissions = pgTable('permissions', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  category: text('category').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const userRoles = pgTable('user_roles', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  roleId: text('role_id').references(() => roles.id, { onDelete: 'cascade' }).notNull(),
  assignedBy: text('assigned_by').references(() => users.id).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userRoleUnique: uniqueIndex('user_role_unique').on(table.userId, table.roleId),
}));

export const rolePermissions = pgTable('role_permissions', {
  id: text('id').primaryKey(),
  roleId: text('role_id').references(() => roles.id, { onDelete: 'cascade' }).notNull(),
  permissionId: text('permission_id').references(() => permissions.id, { onDelete: 'cascade' }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  rolePermissionUnique: uniqueIndex('role_permission_unique').on(table.roleId, table.permissionId),
}));

export const securityAuditLog = pgTable('security_audit_log', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  entity: text('entity'),
  entityId: text('entity_id'),
  oldValue: jsonb('old_value'),
  newValue: jsonb('new_value'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  success: boolean('success').notNull(),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  csrfToken: text('csrf_token').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});