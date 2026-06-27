CREATE TABLE "user_disliked_ingredients" (
	"user_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	CONSTRAINT "user_disliked_ingredients_user_id_ingredient_id_pk" PRIMARY KEY("user_id","ingredient_id")
);
--> statement-breakpoint
ALTER TABLE "user_disliked_ingredients" ADD CONSTRAINT "user_disliked_ingredients_user_id_user_profile_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_disliked_ingredients" ADD CONSTRAINT "user_disliked_ingredients_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profile" DROP COLUMN "disliked_ingredient_ids";