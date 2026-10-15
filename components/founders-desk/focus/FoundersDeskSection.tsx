import { FoundersDeskInbox } from "../FoundersDeskInbox";
import { FocusCard } from "./FocusPrimitives";

/**
 * A prominent Founders' Desk (Mission 8 Focus View redesign, item 4) —
 * its own full-width section rather than one card squeezed between a
 * mission form and a ledger. Wraps the exact same real
 * `FoundersDeskInbox` component and handlers unchanged — every review
 * status, deliverable, and Approve/Reject/Send-Back action is the same
 * real workflow, just given real visual priority. No extra heading
 * here — FoundersDeskInbox already renders its own real one; a second
 * heading on top of it would just repeat the same words.
 */
export function FoundersDeskSection({
  onSelectMission,
  onOpenContentItem,
}: {
  onSelectMission: (missionId: string) => void;
  onOpenContentItem: (contentItemId: string) => void;
}) {
  return (
    <FocusCard>
      <FoundersDeskInbox onSelectMission={onSelectMission} onOpenContentItem={onOpenContentItem} />
    </FocusCard>
  );
}
