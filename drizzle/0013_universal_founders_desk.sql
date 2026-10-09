CREATE TABLE "agent_deliverable_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"deliverable_id" text NOT NULL,
	"founder_id" text NOT NULL,
	"decision" text NOT NULL,
	"note" text,
	"decided_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_deliverables" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_key" text NOT NULL,
	"founder_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"content" jsonb NOT NULL,
	"state" text DEFAULT 'awaiting_review' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_deliverable_reviews" ADD CONSTRAINT "agent_deliverable_reviews_deliverable_id_agent_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."agent_deliverables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_deliverable_reviews" ADD CONSTRAINT "agent_deliverable_reviews_founder_id_founders_id_fk" FOREIGN KEY ("founder_id") REFERENCES "public"."founders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_deliverables" ADD CONSTRAINT "agent_deliverables_agent_key_agents_key_fk" FOREIGN KEY ("agent_key") REFERENCES "public"."agents"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_deliverables" ADD CONSTRAINT "agent_deliverables_founder_id_founders_id_fk" FOREIGN KEY ("founder_id") REFERENCES "public"."founders"("id") ON DELETE no action ON UPDATE no action;