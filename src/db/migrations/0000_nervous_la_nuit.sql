CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"seeker_id" uuid NOT NULL,
	"referrer_id" uuid NOT NULL,
	"cv_filename" varchar(255) NOT NULL,
	"cv_original_name" varchar(255) NOT NULL,
	"cv_mimetype" varchar(80) NOT NULL,
	"cv_size_bytes" integer NOT NULL,
	"cover_note" text,
	"status" varchar(30) DEFAULT 'submitted' NOT NULL,
	"referrer_note" text,
	"hr_email" varchar(320),
	"forwarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applications_status_check" CHECK ("applications"."status" IN ('submitted', 'viewed', 'forwarded', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" uuid NOT NULL,
	"addressee_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connections_status_check" CHECK ("connections"."status" IN ('pending', 'accepted', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_id" uuid NOT NULL,
	"source_url" text NOT NULL,
	"title" varchar(300) NOT NULL,
	"company_name" varchar(200) NOT NULL,
	"location" varchar(200),
	"description" text,
	"job_type" varchar(50),
	"salary_range" varchar(100),
	"bonus_amount" numeric(12, 2),
	"bonus_currency" varchar(10) DEFAULT 'USD',
	"bonus_notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"password_hash" varchar(255),
	"full_name" varchar(200) NOT NULL,
	"headline" varchar(400),
	"avatar_url" text,
	"google_id" varchar(100),
	"company_name" varchar(200),
	"is_referrer" boolean DEFAULT false NOT NULL,
	"is_seeker" boolean DEFAULT true NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"email_verify_token" varchar(64),
	"reset_token" varchar(64),
	"reset_token_exp" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id")
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_seeker_id_users_id_fk" FOREIGN KEY ("seeker_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_addressee_id_users_id_fk" FOREIGN KEY ("addressee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "applications_job_seeker_idx" ON "applications" USING btree ("job_id","seeker_id");--> statement-breakpoint
CREATE INDEX "applications_job_id_idx" ON "applications" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "applications_seeker_id_idx" ON "applications" USING btree ("seeker_id");--> statement-breakpoint
CREATE INDEX "applications_referrer_status_idx" ON "applications" USING btree ("referrer_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_pair_idx" ON "connections" USING btree ("requester_id","addressee_id");--> statement-breakpoint
CREATE INDEX "connections_requester_status_idx" ON "connections" USING btree ("requester_id","status");--> statement-breakpoint
CREATE INDEX "connections_addressee_status_idx" ON "connections" USING btree ("addressee_id","status");--> statement-breakpoint
CREATE INDEX "jobs_referrer_id_idx" ON "jobs" USING btree ("referrer_id");--> statement-breakpoint
CREATE INDEX "jobs_company_name_idx" ON "jobs" USING btree ("company_name");--> statement-breakpoint
CREATE INDEX "jobs_is_active_created_idx" ON "jobs" USING btree ("is_active","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_id_idx" ON "users" USING btree ("google_id");--> statement-breakpoint
CREATE INDEX "users_company_name_idx" ON "users" USING btree ("company_name");