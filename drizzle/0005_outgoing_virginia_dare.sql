ALTER TABLE "content_versions" ADD COLUMN "creative_strategy" jsonb;--> statement-breakpoint
ALTER TABLE "content_versions" ADD COLUMN "qc_report" jsonb;--> statement-breakpoint
ALTER TABLE "content_versions" ADD COLUMN "qc_regeneration_count" integer DEFAULT 0 NOT NULL;