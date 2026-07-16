CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inviter_id" uuid NOT NULL,
	"token" varchar(64) NOT NULL,
	"email" varchar(320),
	"used_at" timestamp with time zone,
	"used_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "onboarded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "invite_code" varchar(16);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "invited_by_id" uuid;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_user_id_users_id_fk" FOREIGN KEY ("used_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invites_inviter_id_idx" ON "invites" USING btree ("inviter_id");--> statement-breakpoint
CREATE INDEX "invites_token_idx" ON "invites" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "users_invite_code_idx" ON "users" USING btree ("invite_code");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_invite_code_unique" UNIQUE("invite_code");