ALTER TABLE "applications" DROP CONSTRAINT "applications_status_check";--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "auto_cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_status_check" CHECK ("applications"."status" IN ('submitted', 'viewed', 'forwarded', 'rejected', 'expired'));