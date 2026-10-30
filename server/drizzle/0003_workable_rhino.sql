ALTER TABLE "parents" ADD COLUMN "paused_until" timestamp;--> statement-breakpoint
ALTER TABLE "parents" ADD COLUMN "paused_at" timestamp;--> statement-breakpoint
ALTER TABLE "parents" ADD COLUMN "pause_reminder_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "parents" ADD COLUMN "no_reply_alerted_at" timestamp;