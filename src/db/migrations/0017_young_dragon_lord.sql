ALTER TABLE "applications" DROP CONSTRAINT "applications_status_check";--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "cv_filename" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "cv_original_name" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "cv_mimetype" varchar(80);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "cv_size_bytes" integer;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_status_check" CHECK ("applications"."status" IN ('submitted', 'viewed', 'forwarded', 'rejected', 'expired', 'internally_submitted', 'withdrawn'));