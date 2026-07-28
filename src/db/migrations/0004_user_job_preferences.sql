ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "desired_role" varchar(200);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "preferred_location" varchar(200);
