// @vitest-environment jsdom
import React, { createElement } from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MissionDetail, type MissionDetailData } from "../components/founders-desk/MissionDetail";
import { makeScoutReport } from "./testUtils";
import type { Mission } from "@/lib/db/types";

(globalThis as unknown as { React: typeof React }).React = React;

function detailWith(report: ReturnType<typeof makeScoutReport>): MissionDetailData {
  return {
    mission: { id: "m", title: "t", brief: "b", state: "ready_for_founders_review", final_status: "investigate_further", failure_reason: null, research_pass_count: 1 } as unknown as Mission,
    stages: [], assignments: [], evidence: [], deliverables: [],
    scoutReport: report, followupReport: null, costs: [], approvals: [], activity: [], contentItems: [],
  };
}

describe("MissionDetail — platform suitability rows", () => {
  it("hides non-applicable Etsy/KDP rows and shows the platforms that do apply", () => {
    const { container } = render(
      createElement(MissionDetail, {
        detail: detailWith(makeScoutReport({ platform_suitability: { etsy_downloads: null, amazon_kdp_print_on_demand: null, other_notes: "YouTube Shorts and TikTok." } })),
      }),
    );
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/Etsy downloads:/);
    expect(text).not.toMatch(/Amazon KDP \(print-on-demand\):/);
    expect(text).toMatch(/Platforms & notes:\s*YouTube Shorts and TikTok\./);
  });

  it("hides the whole section when nothing applies", () => {
    const { container } = render(
      createElement(MissionDetail, {
        detail: detailWith(makeScoutReport({ platform_suitability: { etsy_downloads: null, amazon_kdp_print_on_demand: null, other_notes: null } })),
      }),
    );
    expect(container.textContent ?? "").not.toMatch(/Platform suitability/);
  });

  it("still shows Etsy and KDP rows for an existing report that has them", () => {
    const { container } = render(createElement(MissionDetail, { detail: detailWith(makeScoutReport()) }));
    const text = container.textContent ?? "";
    expect(text).toMatch(/Etsy downloads:/);
    expect(text).toMatch(/Amazon KDP \(print-on-demand\):/);
  });
});
