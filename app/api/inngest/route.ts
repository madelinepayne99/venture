import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { scoutResearchJob } from "@/lib/jobs/scoutResearchJob";
import { stuckMissionWatchdog } from "@/lib/jobs/stuckMissionWatchdog";

// Called by the Inngest dev server locally, or by Inngest Cloud in
// production (signed with INNGEST_SIGNING_KEY) — never by a founder's
// browser. Deliberately excluded from the founder-session middleware (see
// middleware.ts) the same way /api/auth is.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [scoutResearchJob, stuckMissionWatchdog],
});
