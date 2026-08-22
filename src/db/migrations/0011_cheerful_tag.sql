ALTER TABLE "users" ADD COLUMN "employment_type" varchar(20);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "seniority" varchar(20);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "skills" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "open_to_remote" boolean DEFAULT false NOT NULL;