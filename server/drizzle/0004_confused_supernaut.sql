CREATE TYPE "public"."sub_cycle" AS ENUM('monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."sub_plan" AS ENUM('basic', 'family');--> statement-breakpoint
CREATE TYPE "public"."sub_status" AS ENUM('trialing', 'active', 'past_due', 'cancelled', 'expired');--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guardian_id" uuid NOT NULL,
	"parent_id" uuid,
	"plan" "sub_plan" NOT NULL,
	"cycle" "sub_cycle" NOT NULL,
	"status" "sub_status" DEFAULT 'trialing' NOT NULL,
	"paddle_subscription_id" text,
	"paddle_customer_id" text,
	"trial_ends_at" timestamp,
	"renews_at" timestamp,
	"ends_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_parent_id_unique" UNIQUE("parent_id"),
	CONSTRAINT "subscriptions_paddle_subscription_id_unique" UNIQUE("paddle_subscription_id")
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_guardian_id_users_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_parent_id_parents_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."parents"("id") ON DELETE set null ON UPDATE no action;