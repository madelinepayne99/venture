// @vitest-environment jsdom
import React, { createElement } from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MissionBoard } from "../components/founders-desk/hq/MissionBoard";
import type { Mission } from "@/lib/db/types";

(globalThis as unknown as { React: typeof React }).React = React;

function mission(overrides: Partial<Mission>): Mission {
  return {
    id: "m1",
    project_id: null,
    founder_id: "f1",
    title: "A mission",
    brief: "b",
    interpreted_mission: null,
    state: "queued",
    final_status: null,
    failure_reason: null,
    research_pass_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as Mission;
}

// Approved smaller UX fix: the "Completed" bucket header is unchanged (see
// missionStates.ts's missionDockBucket — no bucket split, no relabeling of
// the column itself), but a ready_for_founders_review card gets its own
// small per-card cue so it doesn't read as "nothing left to do."
describe("hq/MissionBoard — ready_for_founders_review reads as awaiting a decision, not just 'Completed'", () => {
  it('shows "Awaiting decision" on a ready_for_founders_review card', () => {
    const { container } = render(
      createElement(MissionBoard, {
        missions: [mission({ id: "m1", title: "Needs a decision", state: "ready_for_founders_review" })],
        selectedMissionId: null,
        onSelectMission: () => {},
      }),
    );
    const text = container.textContent ?? "";
    expect(text).toMatch(/Completed/); // the bucket header itself is untouched
    expect(text).toMatch(/Awaiting decision/);
  });

  it("does not show the cue on other states sharing the same 'Completed' bucket (e.g. rejected)", () => {
    const { container } = render(
      createElement(MissionBoard, {
        missions: [mission({ id: "m1", title: "Rejected one", state: "rejected" })],
        selectedMissionId: null,
        onSelectMission: () => {},
      }),
    );
    expect(container.textContent ?? "").not.toMatch(/Awaiting decision/);
  });

  it("does not show the cue on any other bucket (e.g. researching)", () => {
    const { container } = render(
      createElement(MissionBoard, {
        missions: [mission({ id: "m1", title: "Working", state: "researching" })],
        selectedMissionId: null,
        onSelectMission: () => {},
      }),
    );
    expect(container.textContent ?? "").not.toMatch(/Awaiting decision/);
  });
});
