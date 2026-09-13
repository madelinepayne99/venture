import type { Mission } from "@/lib/db/types";

/**
 * Shared contract every Venture HQ agent implements. Scout is the only
 * agent wired up in this milestone; this interface exists so Inventor,
 * Creator, Inspector, Merchant, the platform specialists, and Manager can
 * be added later without reshaping how missions dispatch work.
 */
export interface AgentRunOutcome<TReport = unknown> {
  /** The agent's structured report, already validated. */
  report: TReport;
  /** Real model usage for this run, for the cost ledger. */
  usage: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    usdCost: number;
  };
  /** Evidence items the agent gathered, if any (e.g. web sources). */
  evidence: Array<{
    sourceUrl?: string | null;
    sourceTitle?: string | null;
    sourceDate?: string | null;
    snippet?: string | null;
    isVerifiedFact: boolean;
  }>;
}

export interface VentureAgent<TReport = unknown> {
  key: string;
  run(mission: Mission): Promise<AgentRunOutcome<TReport>>;
}
