import { describe, expect, it } from "vitest";
import { isScoutResearching, scoutLocationForMissions } from "@/lib/domain/scoutLocation";
import type { Mission, MissionState } from "@/lib/db/types";

function mission(state: MissionState): Mission {
  return { state } as Mission;
}

describe("scoutLocationForMissions — Scout's HQ position, driven by nothing but real mission state", () => {
  it("resolves to the founders' hub when no mission is researching", () => {
    expect(scoutLocationForMissions([])).toBe("founders_hub");
    expect(scoutLocationForMissions([mission("draft"), mission("awaiting_founder_approval")])).toBe(
      "founders_hub"
    );
  });

  it("resolves to the research room when exactly one mission is researching", () => {
    expect(scoutLocationForMissions([mission("researching")])).toBe("research_room");
    expect(scoutLocationForMissions([mission("draft"), mission("researching")])).toBe("research_room");
  });

  it("stays in the research room when two missions are genuinely researching at once", () => {
    const missions = [mission("researching"), mission("researching")];
    expect(isScoutResearching(missions)).toBe(true);
    expect(scoutLocationForMissions(missions)).toBe("research_room");
  });

  it("stays in the research room if one of two concurrent researching missions leaves that state but the other is still researching", () => {
    const missions = [mission("awaiting_evidence"), mission("researching")];
    expect(scoutLocationForMissions(missions)).toBe("research_room");
  });

  it("only returns to the founders' hub once the last researching mission leaves that state", () => {
    const missions = [mission("ready_for_founders_review"), mission("failed")];
    expect(scoutLocationForMissions(missions)).toBe("founders_hub");
  });

  it("treats every terminal/non-researching state as 'not researching'", () => {
    const states: MissionState[] = [
      "draft",
      "awaiting_founder_approval",
      "queued",
      "awaiting_evidence",
      "ready_for_founders_review",
      "rejected",
      "failed",
      "cancelled",
    ];
    for (const state of states) {
      expect(isScoutResearching([mission(state)])).toBe(false);
    }
  });
});
