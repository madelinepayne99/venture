import {
  listAgents,
  listMissionsForOrganization,
  listLeadAssignments,
  listLedgerEntries,
  ledgerTotalUsd,
  listProjects,
  listFounders,
  listAgentTaskWorldSignals,
} from "@/lib/db/repositories";
import { auth } from "@/auth";
import { getActiveOrganizationForFounder } from "@/lib/domain/organizationWorkflow";
import { FoundersDeskApp } from "@/components/founders-desk/FoundersDeskApp";

// This page reads live from Postgres on every request — it must never be
// statically prerendered, or founders would see build-time data forever.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await auth();
  // middleware.ts already redirects an unauthenticated request before this
  // component ever renders — session is present by the time we get here.
  const signedInFounderName = session?.founderName ?? "Unknown founder";

  // Organization-scoped since Master Development Mission 6, Phase E —
  // resolved server-side from the real signed-in founder's own real
  // membership, never from client input. Missions/projects are real,
  // organization-owned data; leadAssignments/agentTaskSignals stay
  // deliberately global for now (they drive the one shared 3D office
  // scene — see app/api/missions/route.ts's own comment for why that's a
  // real, named, not-yet-closed gap rather than an oversight here).
  const organization = await getActiveOrganizationForFounder(session!.founderId!);

  const [agents, missions, leadAssignments, ledgerEntries, ledgerTotal, projects, founders, agentTaskSignals] =
    await Promise.all([
      listAgents(),
      listMissionsForOrganization(organization.id),
      listLeadAssignments(),
      listLedgerEntries(),
      ledgerTotalUsd(),
      listProjects(organization.id),
      listFounders(),
      listAgentTaskWorldSignals(),
    ]);

  return (
    <FoundersDeskApp
      signedInFounderName={signedInFounderName}
      initialAgents={agents}
      initialMissions={missions}
      initialLeadAssignments={leadAssignments}
      initialLedgerEntries={ledgerEntries}
      initialLedgerTotal={ledgerTotal}
      initialProjects={projects}
      initialFounders={founders}
      initialAgentTaskSignals={agentTaskSignals}
    />
  );
}
