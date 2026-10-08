/**
 * Ported verbatim from the approved "Living Polish" redesign (Milestone 8
 * integration). Presentation only. No persisted state, requests, timers,
 * or production decisions.
 */
export type WorldMission = { id: string; state: string; title?: string };
export type WorldContent = { id?: string; mission_id: string; state: string };
export type StudioStatus = { state: string; label: string; title: string; itemId?: string; active: boolean; count: number; reviewRequired?: boolean };
const labels: Record<string, string> = {
  generating: "PRODUCING", planning: "PLANNING", awaiting_review: "FOUNDER REVIEW REQUIRED",
  blocked: "BLOCKED — REVIEW REQUIRED", failed: "PRODUCTION FAILED", revision_requested: "REVISION REQUESTED",
  ready_to_publish: "READY TO PUBLISH", publishing: "PUBLISHING", publish_failed: "PUBLISH FAILED",
};
const priority = ["generating", "planning", "publishing", "awaiting_review", "blocked", "failed", "publish_failed", "revision_requested", "ready_to_publish"];
export function studioStatus(
  missions: readonly WorldMission[],
  assignments: readonly { mission_id: string; agent_key: string }[],
  items: readonly WorldContent[],
): StudioStatus {
  const led = new Set(assignments.filter(a => a.agent_key === "content_bot").map(a => a.mission_id));
  const pending = items.filter(c => led.has(c.mission_id) && !["published", "rejected", "cancelled"].includes(c.state));
  pending.sort((a, b) => {
    const rank = (s: string) => priority.includes(s) ? priority.indexOf(s) : priority.length;
    return rank(a.state) - rank(b.state) || a.mission_id.localeCompare(b.mission_id);
  });
  const reviewRequired = pending.some(c => c.state === "awaiting_review");
  const item = pending[0];
  if (!item) return { state: "available", label: "AVAILABLE", title: "", active: false, count: 0, reviewRequired: false };
  return { state: item.state, label: labels[item.state] ?? "STATUS UNAVAILABLE", title: missions.find(m => m.id === item.mission_id)?.title ?? "",
    itemId: item.id, active: item.state === "generating", count: pending.length, reviewRequired };
}
