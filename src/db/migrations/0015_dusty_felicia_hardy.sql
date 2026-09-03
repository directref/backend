ALTER TABLE "jobs" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "deletion_warning_email_sent_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "jobs_is_active_deactivated_at_idx" ON "jobs" USING btree ("is_active","deactivated_at");