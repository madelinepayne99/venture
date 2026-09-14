import {
  listAgents,
  listMissions,
  listLedgerEntries,
  ledgerTotalUsd,
} from "@/lib/db/repositories";
import { auth } from "@/auth";
import { FoundersDeskApp } from "@/components/founders-desk/FoundersDeskApp";

// This page reads live from Postgres on every request — it must never be
// statically prerendered, or founders would see build-time data forever.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [session, agents, missions, ledgerEntries, ledgerTotal] = await Promise.all([
    auth(),
    listAgents(),
    listMissions(),
    listLedgerEntries(),
    ledgerTotalUsd(),
  ]);

  // middleware.ts already redirects an unauthenticated request before this
  // component ever renders — session is present by the time we get here.
  const signedInFounderName = session?.founderName ?? "Unknown founder";

  return (
    <FoundersDeskApp
      signedInFounderName={signedInFounderName}
      initialAgents={agents}
      initialMissions={missions}
      initialLedgerEntries={ledgerEntries}
      initialLedgerTotal={ledgerTotal}
    />
  );
}
