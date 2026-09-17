import type { Mission } from "@/lib/db/types";

/**
 * Scout's physical location in the HQ scene — driven by nothing but real
 * mission state, exactly the same way `missionDockBucket` (missionStates.ts)
 * derives its buckets. No "traveling" status is ever persisted anywhere;
 * this is a pure function re-evaluated from the real mission list on every
 * render, so there is nothing to desync and nothing to fabricate.
 */
export type ScoutLocation = "founders_hub" | "research_room";

/** True whenever at least one of the given missions is genuinely researching. */
export function isScoutResearching(missions: Mission[]): boolean {
  return missions.some((m) => m.state === "researching");
}

/**
 * Scout's correct location for a given real mission list. If more than one
 * mission in the same room is genuinely `researching` at once, Scout still
 * resolves to the research room — the aggregate condition ("is anything
 * researching") is what matters, not which specific mission, exactly
 * mirroring the existing single-match simplification `Room.tsx` already
 * uses for `researchingMission`.
 */
export function scoutLocationForMissions(missions: Mission[]): ScoutLocation {
  return isScoutResearching(missions) ? "research_room" : "founders_hub";
}
