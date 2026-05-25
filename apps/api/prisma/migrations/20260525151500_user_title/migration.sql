-- Add a user-editable free-form job title shown under the user's name in
-- the top-right profile widget. Nullable; users may leave it blank.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "title" TEXT;
