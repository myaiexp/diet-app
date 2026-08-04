ALTER TABLE "shopping_list_items" ALTER COLUMN "bought" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shopping_list_items" ADD COLUMN "unit" text NOT NULL;--> statement-breakpoint
ALTER TABLE "shopping_list_items" ADD COLUMN "source" text DEFAULT 'generated' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "shopping_list_items_list_ingredient_unit_idx" ON "shopping_list_items" USING btree ("list_id","ingredient_id","unit");--> statement-breakpoint
CREATE UNIQUE INDEX "shopping_lists_week_starting_idx" ON "shopping_lists" USING btree ("week_starting");