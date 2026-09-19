CREATE TABLE "content_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"content_version_id" text NOT NULL,
	"kind" text NOT NULL,
	"storage_provider" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer,
	"duration_seconds" real,
	"width" integer,
	"height" integer,
	"checksum_sha256" text,
	"generator_provider" text,
	"generator_model" text,
	"provider_asset_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" text PRIMARY KEY NOT NULL,
	"mission_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"source_deliverable_id" text,
	"brief" jsonb NOT NULL,
	"audience_context" jsonb NOT NULL,
	"state" text DEFAULT 'planning' NOT NULL,
	"approved_version_id" text,
	"published_version_id" text,
	"platform" text,
	"platform_post_id" text,
	"platform_post_url" text,
	"published_at" timestamp,
	"failure_reason" text,
	"version_count" integer DEFAULT 0 NOT NULL,
	"generation_attempt_count" integer DEFAULT 0 NOT NULL,
	"next_analytics_pull_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"content_item_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"parent_version_id" text,
	"revision_approval_id" text,
	"status" text DEFAULT 'generating' NOT NULL,
	"plan" jsonb,
	"safety_verdict" jsonb,
	"failure_reason" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "costs" ALTER COLUMN "input_tokens" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "costs" ALTER COLUMN "output_tokens" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "content_item_id" text;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "content_version_id" text;--> statement-breakpoint
ALTER TABLE "costs" ADD COLUMN "content_item_id" text;--> statement-breakpoint
ALTER TABLE "costs" ADD COLUMN "content_version_id" text;--> statement-breakpoint
ALTER TABLE "costs" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "costs" ADD COLUMN "unit" text;--> statement-breakpoint
ALTER TABLE "costs" ADD COLUMN "quantity" real;--> statement-breakpoint
ALTER TABLE "mission_stages" ADD COLUMN "content_item_id" text;--> statement-breakpoint
ALTER TABLE "mission_stages" ADD COLUMN "content_version_id" text;--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_content_version_id_content_versions_id_fk" FOREIGN KEY ("content_version_id") REFERENCES "public"."content_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_source_deliverable_id_deliverables_id_fk" FOREIGN KEY ("source_deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_parent_version_id_content_versions_id_fk" FOREIGN KEY ("parent_version_id") REFERENCES "public"."content_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_revision_approval_id_approvals_id_fk" FOREIGN KEY ("revision_approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_assets_provider_key_unique" ON "content_assets" USING btree ("storage_provider","storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "content_items_one_active_per_mission" ON "content_items" USING btree ("mission_id") WHERE state not in ('published','rejected','failed','cancelled');--> statement-breakpoint
CREATE UNIQUE INDEX "content_versions_item_number_unique" ON "content_versions" USING btree ("content_item_id","version_number");--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_content_version_id_content_versions_id_fk" FOREIGN KEY ("content_version_id") REFERENCES "public"."content_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "costs" ADD CONSTRAINT "costs_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "costs" ADD CONSTRAINT "costs_content_version_id_content_versions_id_fk" FOREIGN KEY ("content_version_id") REFERENCES "public"."content_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_stages" ADD CONSTRAINT "mission_stages_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_stages" ADD CONSTRAINT "mission_stages_content_version_id_content_versions_id_fk" FOREIGN KEY ("content_version_id") REFERENCES "public"."content_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_assignments_mission_agent_role_unique" ON "agent_assignments" USING btree ("mission_id","agent_id","role");