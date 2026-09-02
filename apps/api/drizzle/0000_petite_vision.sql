CREATE TABLE IF NOT EXISTS "products" (
	"supplier_product_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"brand" text NOT NULL,
	"category_path" text NOT NULL,
	"category_id" text NOT NULL,
	"color" text,
	"type" text,
	"description_html" text,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prices" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"manual_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'imported' NOT NULL,
	"is_whitelisted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shopware_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_product_id" text NOT NULL,
	"supplier_variant_id" text,
	"shopware_uuid" text NOT NULL,
	"entity_type" text NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_hashes" (
	"supplier_product_id" text PRIMARY KEY NOT NULL,
	"supplier_hash" text,
	"pricing_hash" text,
	"stock_hash" text,
	"image_hash" text,
	"content_hash" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "variants" (
	"supplier_variant_id" text PRIMARY KEY NOT NULL,
	"supplier_product_id" text NOT NULL,
	"name" text NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"available_in" integer DEFAULT 0 NOT NULL,
	"ean" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fee_schedule" (
	"id" text PRIMARY KEY NOT NULL,
	"fee_type" text NOT NULL,
	"amount_net" numeric(10, 2) NOT NULL,
	"source_url" text,
	"source_hash" text,
	"valid_from" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "price_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"vat_rate" numeric(5, 4) DEFAULT '0.1900' NOT NULL,
	"target_margin" numeric(5, 4) DEFAULT '0.4000' NOT NULL,
	"fixed_surcharge_net" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"mode" text DEFAULT 'brutto' NOT NULL,
	"charm_pricing" boolean DEFAULT true NOT NULL,
	"include_freight_in_vk" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pricing_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"price_rule_id" text NOT NULL,
	"old_price_net" numeric(10, 2),
	"new_price_net" numeric(10, 2) NOT NULL,
	"changed_at" timestamp DEFAULT now() NOT NULL,
	"changed_by" text DEFAULT 'system' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shipping_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"country_code" text NOT NULL,
	"carrier" text NOT NULL,
	"weight_class" text NOT NULL,
	"net_price" numeric(10, 2) NOT NULL,
	"lead_days" integer DEFAULT 2 NOT NULL,
	"source" text DEFAULT 'api' NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	"source_hash" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopware_mappings" ADD CONSTRAINT "shopware_mappings_supplier_product_id_products_supplier_product_id_fk" FOREIGN KEY ("supplier_product_id") REFERENCES "public"."products"("supplier_product_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sync_hashes" ADD CONSTRAINT "sync_hashes_supplier_product_id_products_supplier_product_id_fk" FOREIGN KEY ("supplier_product_id") REFERENCES "public"."products"("supplier_product_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "variants" ADD CONSTRAINT "variants_supplier_product_id_products_supplier_product_id_fk" FOREIGN KEY ("supplier_product_id") REFERENCES "public"."products"("supplier_product_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pricing_audit" ADD CONSTRAINT "pricing_audit_product_id_products_supplier_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("supplier_product_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pricing_audit" ADD CONSTRAINT "pricing_audit_price_rule_id_price_rules_id_fk" FOREIGN KEY ("price_rule_id") REFERENCES "public"."price_rules"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
