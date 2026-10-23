-- "Pantry staple" read as a storage place (butter is a staple that lives in the
-- fridge); the flag means "assumed always on hand" and is unrelated to
-- pantry_items.location. Rename only — values are kept.
ALTER TABLE "ingredients" RENAME COLUMN "is_pantry_staple" TO "is_staple";
