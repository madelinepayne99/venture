import {
  listFounders,
  listAgents,
  listMissions,
  listLedgerEntries,
  ledgerTotalUsd,
} from "@/lib/db/repositories";
import { FoundersDeskApp } from "@/components/founders-desk/FoundersDeskApp";

// This page reads live from SQLite on every request — it must never be
// statically prerendered, or founders would see build-time data forever.
export const dynamic = "force-dynamic";

export default function HomePage() {
  const founders = listFounders();
  const agents = listAgents();
  const missions = listMissions();
  const ledgerEntries = listLedgerEntries();
  const ledgerTotal = ledgerTotalUsd();

  return (
    <FoundersDeskApp
      initialFounders={founders}
      initialAgents={agents}
      initialMissions={missions}
      initialLedgerEntries={ledgerEntries}
      initialLedgerTotal={ledgerTotal}
    />
  );
}
