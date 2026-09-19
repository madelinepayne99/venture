import { describe, expect, it } from "vitest";
import type { ContentAsset } from "@/lib/db/types";
import {
  assertNoNamedIP,
  assertAudienceAppropriate,
  assertClaimsAreEvidenced,
  assertAssetsMatchPlan,
  ContentGuardrailError,
} from "@/lib/agents/contentBot/guardrails";
import { makeContentPlan, makeProductionBrief, makeProductionRecommendation, makeAudienceContext } from "./testUtils";

function makeAsset(overrides: Partial<ContentAsset> = {}): ContentAsset {
  return {
    id: "asset-1",
    content_version_id: "version-1",
    kind: "video",
    storage_provider: "local_disk",
    storage_key: "content/item/version/video.mp4",
    content_type: "video/mp4",
    byte_size: 1024,
    duration_seconds: 45,
    width: 1080,
    height: 1920,
    checksum_sha256: "abc123",
    generator_provider: "shotstack",
    generator_model: "default",
    provider_asset_id: "render-1",
    created_at: "2026-09-18T00:00:00.000Z",
    ...overrides,
  };
}

describe("Content Bot guardrails", () => {
  describe("assertNoNamedIP", () => {
    it("rejects a plan referencing a named work Scout flagged as do-not-imitate", () => {
      const brief = makeProductionBrief({
        scout: {
          deliverable_id: "d1",
          verdict: "ready_for_founders_review",
          key_findings: [],
          production_recommendation: makeProductionRecommendation({ do_not_imitate: ["Bluey"] }),
        },
      });
      const plan = makeContentPlan({ description: "A parody segment inspired by Bluey's counting episode." });
      expect(() => assertNoNamedIP(plan, brief)).toThrow(ContentGuardrailError);
    });

    it("rejects generic imitation language even without a named do_not_imitate entry", () => {
      const brief = makeProductionBrief();
      const plan = makeContentPlan({ hook: "A recreation of the viral counting video everyone loved." });
      expect(() => assertNoNamedIP(plan, brief)).toThrow(ContentGuardrailError);
    });

    it("passes a genuinely original plan with no imitation language", () => {
      const brief = makeProductionBrief();
      const plan = makeContentPlan();
      expect(() => assertNoNamedIP(plan, brief)).not.toThrow();
    });
  });

  describe("assertAudienceAppropriate", () => {
    it("rejects purchase-pressure/engagement-solicitation language for a kids audience", () => {
      const plan = makeContentPlan({ description: "Comment below and subscribe for more counting games!" });
      expect(() => assertAudienceAppropriate(plan, makeAudienceContext({ audience: "kids" }))).toThrow(
        ContentGuardrailError,
      );
    });

    it("rejects peril/scary language for a kids audience", () => {
      const plan = makeContentPlan({ hook: "This scary counting monster will surprise your preschooler." });
      expect(() => assertAudienceAppropriate(plan, makeAudienceContext({ audience: "kids" }))).toThrow(
        ContentGuardrailError,
      );
    });

    it("rejects graphic/explicit language for a teen audience", () => {
      const plan = makeContentPlan({ description: "An explicit breakdown of the counting method." });
      expect(() => assertAudienceAppropriate(plan, makeAudienceContext({ audience: "teen" }))).toThrow(
        ContentGuardrailError,
      );
    });

    it("passes a clean plan for a kids audience", () => {
      const plan = makeContentPlan();
      expect(() => assertAudienceAppropriate(plan, makeAudienceContext({ audience: "kids" }))).not.toThrow();
    });

    it("applies no extra restrictions for a general audience", () => {
      const plan = makeContentPlan({ description: "Comment below and subscribe — this scary explicit twist!" });
      expect(() => assertAudienceAppropriate(plan, makeAudienceContext({ audience: "general" }))).not.toThrow();
    });
  });

  describe("assertClaimsAreEvidenced", () => {
    it("rejects a claim citing an evidence_id that isn't a verified fact in the frozen brief", () => {
      const brief = makeProductionBrief({
        evidence: [
          {
            id: "unverified-1",
            source_url: null,
            source_title: null,
            source_date: null,
            snippet: "unverified snippet",
            is_verified_fact: false,
          },
        ],
      });
      const plan = makeContentPlan({ claims: [{ text: "Some claim", evidence_id: "unverified-1" }] });
      expect(() => assertClaimsAreEvidenced(plan, brief)).toThrow(ContentGuardrailError);
    });

    it("rejects a claim citing an evidence_id that isn't in the brief at all", () => {
      const brief = makeProductionBrief();
      const plan = makeContentPlan({ claims: [{ text: "Fabricated claim", evidence_id: "not-real" }] });
      expect(() => assertClaimsAreEvidenced(plan, brief)).toThrow(ContentGuardrailError);
    });

    it("passes a claim citing a real verified fact from the brief", () => {
      const brief = makeProductionBrief();
      const plan = makeContentPlan({
        claims: [{ text: "Etsy allows digital downloads.", evidence_id: brief.evidence[0]!.id }],
      });
      expect(() => assertClaimsAreEvidenced(plan, brief)).not.toThrow();
    });

    it("passes a plan with no claims at all", () => {
      const brief = makeProductionBrief();
      const plan = makeContentPlan({ claims: [] });
      expect(() => assertClaimsAreEvidenced(plan, brief)).not.toThrow();
    });
  });

  describe("assertAssetsMatchPlan", () => {
    it("rejects when no video asset was produced", () => {
      const plan = makeContentPlan();
      expect(() => assertAssetsMatchPlan([], plan)).toThrow(ContentGuardrailError);
    });

    it("rejects a zero-byte video asset", () => {
      const plan = makeContentPlan();
      const assets = [makeAsset({ byte_size: 0 })];
      expect(() => assertAssetsMatchPlan(assets, plan)).toThrow(ContentGuardrailError);
    });

    it("rejects when the rendered duration diverges from the plan's target by more than the tolerance", () => {
      const plan = makeContentPlan({ duration_seconds: 45 });
      const assets = [makeAsset({ duration_seconds: 90 })];
      expect(() => assertAssetsMatchPlan(assets, plan)).toThrow(ContentGuardrailError);
    });

    it("passes when the rendered duration is within tolerance", () => {
      const plan = makeContentPlan({ duration_seconds: 45 });
      const assets = [makeAsset({ duration_seconds: 50 })];
      expect(() => assertAssetsMatchPlan(assets, plan)).not.toThrow();
    });

    it("rejects a thumbnail with no real dimensions", () => {
      const plan = makeContentPlan();
      const assets = [makeAsset(), makeAsset({ id: "thumb-1", kind: "thumbnail", width: null, height: null })];
      expect(() => assertAssetsMatchPlan(assets, plan)).toThrow(ContentGuardrailError);
    });

    it("rejects an empty caption track", () => {
      const plan = makeContentPlan();
      const assets = [makeAsset(), makeAsset({ id: "cap-1", kind: "caption_track", byte_size: 0 })];
      expect(() => assertAssetsMatchPlan(assets, plan)).toThrow(ContentGuardrailError);
    });

    it("passes a fully consistent set of real assets", () => {
      const plan = makeContentPlan({ duration_seconds: 45 });
      const assets = [
        makeAsset({ duration_seconds: 46 }),
        makeAsset({ id: "thumb-1", kind: "thumbnail", width: 1080, height: 1920, duration_seconds: null }),
        makeAsset({ id: "cap-1", kind: "caption_track", byte_size: 200, duration_seconds: null }),
      ];
      expect(() => assertAssetsMatchPlan(assets, plan)).not.toThrow();
    });
  });
});
