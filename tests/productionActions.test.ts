// @vitest-environment jsdom
import React, { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { ProductionActions } from "../components/founders-desk/ProductionActions";
import { makeScoutReport, makeProductionRecommendation } from "./testUtils";
import type { MissionDetailData } from "../components/founders-desk/MissionDetail";
import type { ContentItem, Mission } from "@/lib/db/types";

(globalThis as unknown as { React: typeof React }).React = React;

function detailWith(overrides: {
  state?: Mission["state"];
  scoutReport?: ReturnType<typeof makeScoutReport> | null;
  contentItems?: ContentItem[];
}): MissionDetailData {
  return {
    mission: { id: "m1", title: "A mission", brief: "b", state: overrides.state ?? "ready_for_founders_review", final_status: "ready_for_founders_review", failure_reason: null, research_pass_count: 1 } as unknown as Mission,
    stages: [],
    assignments: [],
    evidence: [],
    deliverables: [],
    scoutReport: overrides.scoutReport === undefined ? makeScoutReport({ production_recommendation: undefined }) : overrides.scoutReport,
    followupReport: null,
    costs: [],
    approvals: [],
    activity: [],
    contentItems: overrides.contentItems ?? [],
  };
}

function noop() {}

function renderActions(detail: MissionDetailData, handlers: Partial<Record<"onOpenApproveForProduction" | "onOpenCommissionPilot" | "onOpenProduceAgain" | "onOpenContentReview", () => void>> = {}) {
  return render(
    createElement(ProductionActions, {
      detail,
      busy: false,
      onOpenApproveForProduction: handlers.onOpenApproveForProduction ?? noop,
      onOpenCommissionPilot: handlers.onOpenCommissionPilot ?? noop,
      onOpenProduceAgain: handlers.onOpenProduceAgain ?? noop,
      onOpenContentReview: handlers.onOpenContentReview ?? noop,
    }),
  );
}

afterEach(cleanup);

describe("ProductionActions — the first-production paths, and the real multi-production list", () => {
  it("shows only 'Approve for production' when Scout genuinely recommended it", () => {
    const detail = detailWith({ scoutReport: makeScoutReport({ production_recommendation: makeProductionRecommendation() }) });
    const { container } = renderActions(detail);
    const text = container.textContent ?? "";
    expect(text).toMatch(/Approve for production/);
    expect(text).not.toMatch(/Commission Anyway/);
  });

  it("shows only 'Commission Anyway' when Scout's report has real research but no recommendation", () => {
    const detail = detailWith({ scoutReport: makeScoutReport({ production_recommendation: undefined }) });
    const { container } = renderActions(detail);
    const text = container.textContent ?? "";
    expect(text).toMatch(/Commission Anyway/);
    expect(text).not.toMatch(/Approve for production/);
  });

  it("shows the production list (not the first-production controls) once a content item already exists", () => {
    const detail = detailWith({
      scoutReport: makeScoutReport({ production_recommendation: undefined }),
      contentItems: [{ id: "c1", state: "planning", brief: { source: "founder_commissioned" } } as unknown as ContentItem],
    });
    const { container } = renderActions(detail);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/Commission Anyway/);
    expect(text).not.toMatch(/Approve for production/);
    expect(text).toMatch(/Production 1/);
    expect(text).toMatch(/planning/);
  });

  it("lists every content item as its own numbered production, in order", () => {
    const detail = detailWith({
      contentItems: [
        { id: "c1", state: "awaiting_review", brief: { source: "founder_commissioned" } } as unknown as ContentItem,
        { id: "c2", state: "generating", brief: { source: "founder_commissioned" } } as unknown as ContentItem,
        { id: "c3", state: "planning", brief: { source: "founder_commissioned" } } as unknown as ContentItem,
      ],
    });
    const { container, getByText } = renderActions(detail);
    const text = container.textContent ?? "";
    expect(text).toMatch(/Production 1/);
    expect(text).toMatch(/Production 2/);
    expect(text).toMatch(/Production 3/);
    expect(getByText(/awaiting review/)).toBeTruthy();
    expect(getByText(/generating/)).toBeTruthy();
    expect(getByText(/^planning$/)).toBeTruthy();
  });

  it("shows the persistent 'Founder Commissioned' badge only for a founder-commissioned content item", () => {
    const founderItem = detailWith({
      contentItems: [{ id: "c1", state: "planning", brief: { source: "founder_commissioned" } } as unknown as ContentItem],
    });
    const { container: c1 } = renderActions(founderItem);
    expect(c1.textContent ?? "").toMatch(/Founder Commissioned/);

    const scoutItem = detailWith({
      contentItems: [{ id: "c2", state: "planning", brief: { source: "scout_recommended" } } as unknown as ContentItem],
    });
    const { container: c2 } = renderActions(scoutItem);
    expect(c2.textContent ?? "").not.toMatch(/Founder Commissioned/);
  });

  it("shows nothing at all when there's no report, no recommendation, and no content item", () => {
    const detail = detailWith({ scoutReport: null });
    const { container } = renderActions(detail);
    expect(container.textContent ?? "").toBe("");
  });

  it("clicking Commission Anyway calls the distinct handler, not the normal approve handler", () => {
    const detail = detailWith({ scoutReport: makeScoutReport({ production_recommendation: undefined }) });
    const onOpenApproveForProduction = vi.fn();
    const onOpenCommissionPilot = vi.fn();
    const { getByText } = renderActions(detail, { onOpenApproveForProduction, onOpenCommissionPilot });
    fireEvent.click(getByText("Commission Anyway"));
    expect(onOpenCommissionPilot).toHaveBeenCalledTimes(1);
    expect(onOpenApproveForProduction).not.toHaveBeenCalled();
  });

  it("neither first-production control shows for a mission not in ready_for_founders_review", () => {
    const detail = detailWith({ state: "researching", scoutReport: makeScoutReport({ production_recommendation: undefined }) });
    const { container } = renderActions(detail);
    expect(container.textContent ?? "").toBe("");
  });

  describe("Produce Again — the multi-production action", () => {
    it("is never shown before any production exists — the first production only ever uses Approve/Commission", () => {
      const detail = detailWith({ scoutReport: makeScoutReport({ production_recommendation: undefined }) });
      const { queryByText } = renderActions(detail);
      expect(queryByText(/Produce Again/)).toBeNull();
    });

    it("appears once at least one production exists, alongside the production list — never Approve/Commission again", () => {
      const detail = detailWith({
        scoutReport: makeScoutReport({ production_recommendation: undefined }),
        contentItems: [{ id: "c1", state: "awaiting_review", brief: { source: "founder_commissioned" } } as unknown as ContentItem],
      });
      const { getByText, queryByText } = renderActions(detail);
      expect(getByText(/Produce Again/)).toBeTruthy();
      expect(queryByText("Commission Anyway")).toBeNull();
      expect(queryByText("Approve for production")).toBeNull();
    });

    it("clicking Produce Again calls its own distinct handler, never the first-production handlers", () => {
      const detail = detailWith({
        contentItems: [{ id: "c1", state: "awaiting_review", brief: { source: "founder_commissioned" } } as unknown as ContentItem],
      });
      const onOpenProduceAgain = vi.fn();
      const onOpenCommissionPilot = vi.fn();
      const onOpenApproveForProduction = vi.fn();
      const { getByText } = renderActions(detail, { onOpenProduceAgain, onOpenCommissionPilot, onOpenApproveForProduction });
      fireEvent.click(getByText(/Produce Again/));
      expect(onOpenProduceAgain).toHaveBeenCalledTimes(1);
      expect(onOpenCommissionPilot).not.toHaveBeenCalled();
      expect(onOpenApproveForProduction).not.toHaveBeenCalled();
    });

    it("is not offered once the mission's research is no longer in a producible state (e.g. cancelled)", () => {
      const detail = detailWith({
        state: "cancelled",
        contentItems: [{ id: "c1", state: "cancelled", brief: { source: "founder_commissioned" } } as unknown as ContentItem],
      });
      const { queryByText } = renderActions(detail);
      expect(queryByText(/Produce Again/)).toBeNull();
    });
  });
});
