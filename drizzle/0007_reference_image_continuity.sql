ALTER TABLE "content_versions" ADD COLUMN "reference_qc_verdict" jsonb;--> statement-breakpoint
ALTER TABLE "content_versions" ADD COLUMN "reference_regeneration_count" integer DEFAULT 0 NOT NULL;