ALTER TABLE "applications" DROP CONSTRAINT "applications_status_check";--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "submit_reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "submit_followup_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_status_check" CHECK ("applications"."status" IN ('submitted', 'viewed', 'forwarded', 'rejected', 'expired', 'internally_submitted'));