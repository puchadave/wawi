CREATE TABLE IF NOT EXISTS "sync_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_product_id" text NOT NULL,
	"job_id" text,
	"status" text NOT NULL,
	"error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sync_attempts" ADD CONSTRAINT "sync_attempts_supplier_product_id_products_supplier_product_id_fk" FOREIGN KEY ("supplier_product_id") REFERENCES "public"."products"("supplier_product_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
