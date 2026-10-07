CREATE TABLE "agent_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_key" text NOT NULL,
	"founder_id" text NOT NULL,
	"task_type" text NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"state" text DEFAULT 'open' NOT NULL,
	"due_at" timestamp,
	"payload" jsonb,
	"result" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_agent_key_agents_key_fk" FOREIGN KEY ("agent_key") REFERENCES "public"."agents"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_founder_id_founders_id_fk" FOREIGN KEY ("founder_id") REFERENCES "public"."founders"("id") ON DELETE no action ON UPDATE no action;