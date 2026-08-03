CREATE TABLE "credit_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"package_id" varchar(40) NOT NULL,
	"credits" integer NOT NULL,
	"remaining_credits" integer NOT NULL,
	"price_paid" numeric(10, 2) NOT NULL,
	"currency" varchar(10) DEFAULT 'ILS' NOT NULL,
	"purchased_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "free_credits_month" varchar(7);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "free_credits_used" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_purchases" ADD CONSTRAINT "credit_purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_purchases_user_id_idx" ON "credit_purchases" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "credit_purchases_user_expiry_idx" ON "credit_purchases" USING btree ("user_id","expires_at");