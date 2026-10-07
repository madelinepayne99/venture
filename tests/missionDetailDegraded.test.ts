// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import React, { createElement } from "react";
import { render } from "@testing-library/react";
import { MissionDetail, type MissionDetailData } from "../components/founders-desk/MissionDetail";
import { makeScoutReport } from "./testUtils";
import type { Mission } from "@/lib/db/types";

// The app's components rely on Next's automatic JSX runtime; plain Vitest's
// esbuild transform emits React.createElement, so expose React globally here.
(globalThis as unknown as { React: typeof React }).React = React;

// The founder-facing side of the narrow pass-2 fallback: a mission that
// reached founder review because its follow-up pass technically failed must
// say so plainly — derived only from the real failed follow-up stage row.
function detailWith(stages: MissionDetailData["stages"], state: Mission["state"] = "ready_for_founders_review"): MissionDetailData {
  const mission = {
    id: "m1",
    title: "Bees to honey",
    brief: "b",
    state,
    final_status: "investigate_further",
    failure_reason: null,
    research_pass_count: 2,
  } as unknown as Mission;
  return {
    mission,
    stages,
    assignments: [],
    evidence: [],
    deliverables: [],
    scoutReport: makeScoutReport({ verdict: "investigate_further" }),
    followupReport: null,
    costs: [],
    approvals: [],
    activity: [],
    contentItems: [],
  };
}

describe("MissionDetail — degraded founder review after a failed follow-up", () => {
  it("shows the degraded banner, the plain-language wording, and the real failure reason", () => {
    const { container } = render(
      createElement(MissionDetail, {
        detail: detailWith([
          { id: "s1", stage_name: "scout_research", status: "completed", detail: "Pass 1 verdict: investigate_further" },
          { id: "s2", stage_name: "scout_followup_research", status: "failed", detail: "Scout's report was not valid JSON." },
        ]),
      }),
    );
    const text = container.textContent ?? "";
    expect(text).toMatch(/Follow-up research failed — this review is based on Scout.s first research pass\. Some evidence gaps remain\./);
    expect(text).toMatch(/Why the follow-up failed: Scout's report was not valid JSON\./);
    expect(text).not.toMatch(/Evidence inconclusive after/);
  });

  it("shows the ordinary inconclusive banner (not the degraded one) when the follow-up succeeded", () => {
    const { container } = render(
      createElement(MissionDetail, {
        detail: detailWith([
          { id: "s1", stage_name: "scout_research", status: "completed", detail: null },
          { id: "s2", stage_name: "scout_followup_research", status: "completed", detail: null },
        ]),
      }),
    );
    const text = container.textContent ?? "";
    expect(text).toMatch(/Evidence inconclusive after 2 investigations/);
    expect(text).not.toMatch(/Follow-up research failed/);
  });
});

describe("MissionDetail — production-recommendation inconsistency banner", () => {
  function detailWithActivity(activity: MissionDetailData["activity"]): MissionDetailData {
    const mission = {
      id: "m2",
      title: "Find our next viral short",
      brief: "b",
      state: "ready_for_founders_review",
      final_status: "ready_for_founders_review",
      failure_reason: null,
      research_pass_count: 1,
    } as unknown as Mission;
    return {
      mission,
      stages: [{ id: "s1", stage_name: "scout_research", status: "completed", detail: null }],
      assignments: [],
      evidence: [],
      deliverables: [],
      scoutReport: makeScoutReport({ verdict: "ready_for_founders_review" }),
      followupReport: null,
      costs: [],
      approvals: [],
      activity,
      contentItems: [],
    };
  }

  it("shows the production-unavailable banner when the mission's activity carries the real inconsistency flag", () => {
    const { container } = render(
      createElement(MissionDetail, {
        detail: detailWithActivity([
          {
            id: "a1",
            mission_id: "m2",
            actor: "system",
            action: "production_recommendation_inconsistent",
            detail: 'Scout\'s recommended_next_action appears to recommend production ("Produce one pilot").',
            created_at: new Date().toISOString(),
          } as unknown as MissionDetailData["activity"][number],
        ]),
      }),
    );
    const text = container.textContent ?? "";
    expect(text).toMatch(/Production unavailable/);
    expect(text).toMatch(/did not provide the required structured/i);
    expect(text).toMatch(/Produce one pilot/);
    expect(text).not.toMatch(/Approve for production/i);
  });

  it("shows no such banner when the activity log has no inconsistency flag", () => {
    const { container } = render(createElement(MissionDetail, { detail: detailWithActivity([]) }));
    expect(container.textContent ?? "").not.toMatch(/Production unavailable/);
  });
});
