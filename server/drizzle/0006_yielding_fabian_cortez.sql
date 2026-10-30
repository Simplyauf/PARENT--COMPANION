ALTER TABLE "parents" ADD COLUMN "is_guest" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "parents" ADD COLUMN "guest_message_count" integer DEFAULT 0 NOT NULL;