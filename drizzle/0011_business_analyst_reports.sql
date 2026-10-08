CREATE TABLE "business_analyst_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"founder_id" text NOT NULL,
	"query" text NOT NULL,
	"state" text NOT NULL,
	"report" jsonb,
	"error" text,
	"model" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"usd_cost" real,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_analyst_reports" ADD CONSTRAINT "business_analyst_reports_founder_id_founders_id_fk" FOREIGN KEY ("founder_id") REFERENCES "public"."founders"("id") ON DELETE no action ON UPDATE no action;