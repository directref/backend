ALTER TABLE "users" ADD COLUMN "linkedin_id" varchar(100);--> statement-breakpoint
CREATE UNIQUE INDEX "users_linkedin_id_idx" ON "users" USING btree ("linkedin_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_linkedin_id_unique" UNIQUE("linkedin_id");