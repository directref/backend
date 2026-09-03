ALTER TABLE "users" ADD COLUMN "work_email" varchar(320);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "work_email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "work_email_verify_token" varchar(64);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "work_email_verify_token_exp" timestamp with time zone;