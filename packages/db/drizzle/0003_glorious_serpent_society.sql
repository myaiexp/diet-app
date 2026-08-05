CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ean" text NOT NULL,
	"sok_id" text,
	"store_id" text NOT NULL,
	"name" text NOT NULL,
	"brand_name" text,
	"slug" text,
	"price" numeric,
	"price_unit" text,
	"comparison_price" numeric,
	"comparison_unit" text,
	"country_of_origin" text,
	"ingredient_statement" text,
	"nutrition_per_100g" jsonb,
	"category_path" text[] DEFAULT '{}',
	"frozen" boolean DEFAULT false,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_store_ean_unique" UNIQUE("store_id","ean")
);
--> statement-breakpoint
CREATE INDEX "products_ean_idx" ON "products" USING btree ("ean");