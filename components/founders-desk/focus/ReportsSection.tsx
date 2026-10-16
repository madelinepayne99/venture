import { BusinessAnalystPanel } from "../BusinessAnalystPanel";
import { FocusCard } from "./FocusPrimitives";

/**
 * Reports (Mission 8 Focus View redesign) — Business Analyst's real,
 * sourced research requests and their results. The one genuine
 * "standalone reporting" capability this app has today; a real cost/
 * spend breakdown already lives in Finance's ledger rather than being
 * duplicated here. No extra heading — BusinessAnalystPanel already
 * renders its own real one.
 */
export function ReportsSection() {
  return (
    <FocusCard>
      <BusinessAnalystPanel />
    </FocusCard>
  );
}
