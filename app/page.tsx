import {
  listAgents,
  listMissionsForOrganization,
  listLeadAssignmentsForOrganization,
  listLedgerEntries,
  ledgerTotalUsd,
  listProjects,
  listFounders,
  listAgentTaskWorldSignalsForOrganization,
  listOrganizationMembershipsForFounder,
} from "@/lib/db/repositories";
import { auth } from "@/auth";
import { getActiveOrganizationForFounder } from "@/lib/domain/organizationWorkflow";
import { FoundersDeskApp } from "@/components/founders-desk/FoundersDeskApp";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";

// This page reads live from Postgres on every request — it must never be
// statically prerendered, or founders would see build-time data forever.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await auth();
  // middleware.ts already redirects an unauthenticated request before this
  // component ever renders — session is present by the time we get here.
  const signedInFounderName = session?.founderName ?? "Unknown founder";

  // Mission 8, Sections 11-12: a genuinely new customer (real self-service
  // sign-up, see auth.ts's ALLOW_NEW_CUSTOMER_SIGNUP) has a real founder
  // row but, on their very first visit, zero organization memberships.
  // getActiveOrganizationForFounder below would throw for them (by
  // design — "no organization" is a real error for every other caller)
  // — checked here first so a brand-new founder gets the real onboarding
  // flow instead of a crashed page. Ellis and Maddie, and every other
  // founder with a real membership, never see this — identical behavior
  // to before this check existed.
  const memberships = await listOrganizationMembershipsForFounder(session!.founderId!);
  if (memberships.length === 0) {
    return <OnboardingFlow founderName={signedInFounderName} />;
  }

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
