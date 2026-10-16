CREATE TABLE "budget_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"purpose" text NOT NULL,
	"reserved_usd" real NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"actual_usd_cost" real,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"settled_at" timestamp,
	CONSTRAINT "budget_reservations_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "organization_budgets" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"monthly_usd_limit" real,
	"max_concurrent_paid_tasks" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_budgets_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
ALTER TABLE "costs" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD CONSTRAINT "budget_reservations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_budgets" ADD CONSTRAINT "organization_budgets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "costs" ADD CONSTRAINT "costs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;