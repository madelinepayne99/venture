CREATE TABLE "organization_agents" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"agent_key" text NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"founder_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_founder_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_deliverable_reviews" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "agent_deliverables" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "business_analyst_reports" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "checklists" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "chief_of_staff_goals" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "organization_agents" ADD CONSTRAINT "organization_agents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_agents" ADD CONSTRAINT "organization_agents_agent_key_agents_key_fk" FOREIGN KEY ("agent_key") REFERENCES "public"."agents"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_founder_id_founders_id_fk" FOREIGN KEY ("founder_id") REFERENCES "public"."founders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_founder_id_founders_id_fk" FOREIGN KEY ("owner_founder_id") REFERENCES "public"."founders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_agents_org_agent_unique" ON "organization_agents" USING btree ("organization_id","agent_key");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_org_founder_unique" ON "organization_members" USING btree ("organization_id","founder_id");--> statement-breakpoint
ALTER TABLE "agent_deliverable_reviews" ADD CONSTRAINT "agent_deliverable_reviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_deliverables" ADD CONSTRAINT "agent_deliverables_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_analyst_reports" ADD CONSTRAINT "business_analyst_reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chief_of_staff_goals" ADD CONSTRAINT "chief_of_staff_goals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;