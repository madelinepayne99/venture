CREATE TABLE "chief_of_staff_goals" (
	"id" text PRIMARY KEY NOT NULL,
	"founder_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD COLUMN "goal_id" text;--> statement-breakpoint
ALTER TABLE "chief_of_staff_goals" ADD CONSTRAINT "chief_of_staff_goals_founder_id_founders_id_fk" FOREIGN KEY ("founder_id") REFERENCES "public"."founders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_goal_id_chief_of_staff_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."chief_of_staff_goals"("id") ON DELETE no action ON UPDATE no action;