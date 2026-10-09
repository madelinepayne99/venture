import {
  listAgents,
  listMissionsForOrganization,
  listLeadAssignmentsForOrganization,
  listLedgerEntries,
  ledgerTotalUsd,
  listProjects,
  listFounders,
  listAgentTaskWorldSignalsForOrganization,
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

  // Organization-scoped since Master Development Mission 6 — resolved
  // server-side from the real signed-in founder's own real membership,
  // never from client input. leadAssignments/agentTaskSignals are now
  // organization-scoped too (Phase F): a pure data-scoping change, zero
  // changes to the 3D world itself (Astra's own design) — see
  // listLeadAssignmentsForOrganization's own doc comment.
  const organization = await getActiveOrganizationForFounder(session!.founderId!);

  const [agents, missions, leadAssignments, ledgerEntries, ledgerTotal, projects, founders, agentTaskSignals] =
    await Promise.all([
      listAgents(),
      listMissionsForOrganization(organization.id),
      listLeadAssignmentsForOrganization(organization.id),
      listLedgerEntries(),
      ledgerTotalUsd(),
      listProjects(organization.id),
      listFounders(),
      listAgentTaskWorldSignalsForOrganization(organization.id),
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
