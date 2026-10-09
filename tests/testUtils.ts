import type Anthropic from "@anthropic-ai/sdk";
import type { CommerceReport, ServiceBusinessReport, ProductionRecommendation, ScoutReport } from "@/lib/agents/scout/schema";
import type { ProductionBrief, FounderCommission } from "@/lib/domain/contentHandoff";
import type { AudienceContext, VideoRequest, MediaResult, AsyncMediaProvider } from "@/lib/media/types";
import type { ContentPlan, CreativeStrategy, VisualQCReport } from "@/lib/agents/contentBot/schema";
import type { Evidence, Mission } from "@/lib/db/types";
import {
  createProject,
  createMission,
  transitionMissionState,
  recordEvidence,
  recordDeliverable,
  getAgentByKey,
} from "@/lib/db/repositories";
import { getActiveOrganizationForFounder } from "@/lib/domain/organizationWorkflow";

export function makeScoutReport(overrides: Partial<CommerceReport> = {}): CommerceReport {
  return {
    workspace_type: "commerce",
    interpreted_mission: "Research demand for printable counting worksheets for preschoolers.",
    research_questions: ["Is there real search demand for this on Etsy?"],
    potential_customer: "Parents of children aged 3-5 looking for low-cost home learning material.",
    evidence_of_demand: "Evidence suggests moderate interest, though this is not certain.",
    competition_observations: "Several similar listings exist on Etsy already.",
    opportunity_gaps: "Few listings target bilingual households.",
    originality_considerations: "Design would need to be distinct from existing best-sellers.",
    platform_suitability: {
      etsy_downloads: "Well suited — low file-size digital download.",
      amazon_kdp_print_on_demand: "Suitable as a printed activity book.",
      other_notes: null,
    },
    estimated_production_difficulty: { level: "low", rationale: "Simple worksheet layout." },
    likely_costs: { estimate: "Likely low, mostly design time.", breakdown: ["design time"] },
    important_risks: ["Market may already be saturated."],
    copyright_trademark_concerns: [],
    sources: [
      {
        url: "https://example.com/etsy-trends",
        title: "Etsy seller trends report",
        published_date: "2026-01-15",
        accessed_date: "2026-09-13",
      },
    ],
    verified_facts: [
      {
        statement: "Etsy allows digital downloads in the 'craft supplies & tools' and other categories.",
        source_url: "https://example.com/etsy-trends",
      },
    ],
    inferences: ["This category may reward bilingual variants, based on limited competitor data."],
    unresolved_questions: [],
    recommended_next_action: "Proceed to founders' review.",
    verdict: "ready_for_founders_review",
    verdict_rationale: "Reasonable evidence of demand and low production difficulty.",
    ...overrides,
  };
}

export function makeServiceBusinessReport(
  overrides: Partial<ServiceBusinessReport> = {},
): ServiceBusinessReport {
  return {
    workspace_type: "service_business",
    interpreted_mission: "Research a client-retention plan for a UK independent hairdresser.",
    research_questions: ["What retention tactics do comparable UK salons actually use?"],
    potential_customer: "Existing clients of a small, independent UK hairdresser.",
    evidence_of_demand: "Evidence suggests repeat-client loyalty schemes are common in the sector.",
    competition_observations: "Several nearby salons already run simple loyalty-card schemes.",
    service_delivery_considerations: "Appointment reminders and rebooking prompts are low-cost to add.",
    client_retention_or_acquisition_gaps: "Few local salons appear to use SMS-based rebooking reminders.",
    regulatory_and_compliance_notes: [
      {
        note: "Storing client contact details for reminders is personal data processing under UK GDPR.",
        source_url: "https://ico.org.uk/for-organisations/",
        source_quality: "primary_regulator",
      },
    ],
    pricing_or_service_model_considerations: {
      summary: "A simple loyalty scheme could plausibly improve rebooking rates, though this is not certain.",
      considerations: ["Staff time to administer a loyalty scheme."],
    },
    important_risks: ["Clients may not opt in to SMS reminders."],
    sources: [
      {
        url: "https://ico.org.uk/for-organisations/",
        title: "ICO guidance for organisations",
        published_date: "2025-11-01",
        accessed_date: "2026-09-13",
      },
    ],
    verified_facts: [
      {
        statement: "The ICO is the UK's independent regulator for data protection.",
        source_url: "https://ico.org.uk/for-organisations/",
      },
    ],
    inferences: ["A loyalty scheme may modestly improve retention, based on comparable local salons."],
    unresolved_questions: [],
    recommended_next_action: "Proceed to founders' review.",
    verdict: "ready_for_founders_review",
    verdict_rationale: "Reasonable evidence of a low-cost retention opportunity with a manageable compliance step.",
    ...overrides,
  };
}

export function makeProductionRecommendation(
  overrides: Partial<ProductionRecommendation> = {},
): ProductionRecommendation {
  return {
    content_format: "60s vertical explainer, single-presenter VO",
    hook_pattern: "Open with a surprising real statistic.",
    why_it_works: "Short, evidence-backed explainers perform well for this audience.",
    target_audience: "Parents of children aged 3-5.",
    target_platforms: ["youtube_shorts"],
    saturation: "moderate",
    repeatability: "series",
    monetisation_fit: "Could plausibly drive traffic to the Etsy listing, not certain.",
    suggested_original_angle: "A first-person 'day in the life' framing, not a reproduction of any specific video.",
    do_not_imitate: [],
    supporting_evidence_urls: ["https://example.com/etsy-trends"],
    ...overrides,
  };
}

export function makeFounderCommission(overrides: Partial<FounderCommission> = {}): FounderCommission {
  return {
    commissioned_by_founder_id: "founder-1",
    commissioned_at: "2026-09-25T00:00:00.000Z",
    concept: "An original speculative-creature explainer, narrated calmly, one invented creature per video.",
    creative_direction: "Calm, factual narration over a single AI-generated creature reveal; no jump-scares.",
    do_not_imitate: [],
    ...overrides,
  };
}

export function makeAudienceContext(overrides: Partial<AudienceContext> = {}): AudienceContext {
  return {
    platform: "youtube_shorts",
    audience: "general",
    contentType: "educational",
    workspaceType: "commerce",
    ...overrides,
  };
}

export function makeProductionBrief(overrides: Partial<ProductionBrief> = {}): ProductionBrief {
  return {
    source: "scout_recommended",
    mission: {
      id: "mission-1",
      title: "Preschool counting worksheets",
      brief: "Research demand for printable counting worksheets on Etsy.",
      interpreted_mission: "Research demand for printable counting worksheets for preschoolers.",
    },
    project: { id: "project-1", name: "Digital Products", platform_focus: null, workspace_type: "commerce" },
    scout: {
      deliverable_id: "deliverable-1",
      verdict: "ready_for_founders_review",
      key_findings: ["Etsy allows digital downloads in several relevant categories."],
      production_recommendation: makeProductionRecommendation(),
    },
    founder_commission: null,
    evidence: [
      {
        id: "evidence-1",
        source_url: "https://example.com/etsy-trends",
        source_title: "Etsy seller trends report",
        source_date: "2026-01-15",
        snippet: "Digital downloads are a growing Etsy category.",
        is_verified_fact: true,
      },
    ],
    founder_notes: null,
    frozen_at: "2026-09-18T00:00:00.000Z",
    ...overrides,
  };
}

export function makeContentPlan(overrides: Partial<ContentPlan> = {}): ContentPlan {
  return {
    title: "5 Counting Games Your Preschooler Will Love",
    description: "A quick, original walkthrough of five counting games using printable worksheets.",
    tags: ["preschool", "counting", "printables"],
    duration_seconds: 45,
    aspect_ratio: "9:16",
    hook: "Your preschooler is about to love counting.",
    hook_visual: "A bright, original close-up of colorful counting worksheets spreading across a table.",
    script: [
      {
        index: 0,
        beat_role: "hook",
        // Long enough to roughly fit this plan's 45s duration_seconds at
        // the guardrail's real measured rate (~2.44 words/sec — see
        // MEASURED_WORDS_PER_SECOND in guardrails.ts) together with beat
        // 1 — see assertNarrationFitsDuration's own doc comment for why
        // this matters: a real live failure showed narration length and
        // stated duration can otherwise disagree completely.
        narration:
          "Here are five counting games you can print and play at home with your preschooler today. Each one uses a simple black and white worksheet that's easy to prepare in just a couple of minutes, so you can get started right away without any special materials or complicated setup.",
        visual_direction: "A bright, original illustration of counting worksheets on a table.",
        starting_state: "The counting worksheets lie flat and still on the table.",
        action: "A hand slides a fresh worksheet into view and sets a pencil down beside it.",
        ending_state: "The worksheet and pencil sit ready on the table.",
        clip_duration_seconds: 5,
        subject_prominence: "full" as const,
        shot_type: "wide",
        camera_movement: "zoom_in",
        movement_intensity: "slow",
        transition_in: "cut",
        on_screen_text: null,
        retention_purpose: "Opens with a concrete, visual promise (five real games) to earn the next few seconds.",
        start_seconds: 0,
        end_seconds: 22,
      },
      {
        index: 1,
        beat_role: "context",
        narration:
          "Etsy sellers already offer digital downloads just like this, and plenty of parents are actively searching for exactly this kind of low-cost, high-quality printable activity. It's a great example of a real, growing market that's simple enough for us to enter without any specialized equipment or design experience.",
        visual_direction: "An original illustration of a laptop showing a generic marketplace-style page.",
        starting_state: "A laptop sits closed on a desk.",
        action: "The laptop lid opens, revealing a generic marketplace-style page loading on screen.",
        ending_state: "The marketplace-style page is fully loaded on the open laptop screen.",
        clip_duration_seconds: 5,
        subject_prominence: "full" as const,
        shot_type: "medium",
        camera_movement: "pan_left",
        movement_intensity: "normal",
        transition_in: "fade",
        on_screen_text: null,
        retention_purpose: "Grounds the concept in something familiar before moving on.",
        start_seconds: 22,
        end_seconds: 45,
      },
    ],
    claims: [{ text: "Etsy allows digital downloads in several relevant categories.", evidence_id: "evidence-1" }],
    thumbnail_brief: { prompt: "A bright original illustration of counting worksheets.", text_overlay: "5 Counting Games" },
    voice_direction: { pace: "natural" },
    visual_identity: null,
    disclosure: { text: "AI-generated, fictional content.", placement: "persistent_badge" },
    originality_statement: "This is an original execution — no specific existing video, character, or work is reproduced.",
    ...overrides,
  };
}

export function makeCreativeStrategy(overrides: Partial<CreativeStrategy> = {}): CreativeStrategy {
  return {
    hook_mechanic: "Open on a concrete, visual promise (five real games) rather than an abstract claim.",
    visual_hook: "A bright close-up of the printable worksheets themselves, filling the frame.",
    pacing: { target_cut_count: 5, rationale: "Short beats keep momentum for a sub-60s explainer." },
    escalation_shape: "Promise, ground in a familiar platform, then close with a clear call to look further.",
    visual_treatment: "Bright, consistent original illustration style throughout — no photorealism needed.",
    caption_treatment: "Short, phrase-length captions synced to narration.",
    disclosure_treatment: "A small persistent badge — this is an ordinary informational explainer, not likely to be mistaken for something else.",
    retention_strategy: "Leads with a concrete visual promise, per evidence that hook strength drives completion in the first seconds.",
    evidence_ids_referenced: ["evidence-1"],
    ...overrides,
  };
}

// findings holds ONLY genuine problems (see VisualQCReportSchema's own doc
// comment) — a clean "pass" report has an empty findings array, never a
// full pass/fail entry per asset.
export function makeVisualQCReport(overrides: Partial<VisualQCReport> = {}): VisualQCReport {
  return {
    overall_verdict: "pass",
    findings: [],
    ...overrides,
  };
}

/** A minimal, valid 1x1 JPEG, base64-encoded — a real (tiny) image byte sequence for QC-related fixtures that need genuine image bytes without a real provider call. */
export const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=";

export function fakeAnthropicMessage(report: unknown, overrides: Partial<Anthropic.Message> = {}) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content: [{ type: "text", text: JSON.stringify(report), citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 1000,
      output_tokens: 500,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      server_tool_use: null,
    },
    ...overrides,
  } as unknown as Anthropic.Message;
}

export function fakeAnthropicClient(
  responses: Array<ReturnType<typeof fakeAnthropicMessage>>,
): Anthropic {
  return fakeAnthropicClientWithCalls(responses).client;
}

/**
 * Same canned-response behavior as fakeAnthropicClient, but also records the
 * params passed to every messages.create call — for tests that need to
 * assert something about a *specific* call (e.g. that a bounded recovery
 * call never receives `tools`, keeping it unable to trigger new search
 * spend), not just its return value.
 */
/**
 * Real DB setup for any test exercising the Approve-for-Production gate or
 * anything downstream of it: a real project, a real mission already at
 * "ready_for_founders_review", real evidence, and a real Scout deliverable
 * carrying a genuine production_recommendation. Mirrors exactly what
 * runScoutPipeline's real settlement path would have produced — this
 * helper just skips re-running the (already separately tested) research
 * pipeline itself.
 */
export async function setupMissionReadyForProduction(
  founderId: string,
  overrides: { reportOverrides?: Partial<CommerceReport> } = {},
): Promise<{ mission: Mission; evidence: Evidence[]; report: CommerceReport }> {
  const organization = await getActiveOrganizationForFounder(founderId);
  const project = await createProject({ name: "Digital Products (test)", organizationId: organization.id, workspaceType: "commerce" });
  const mission = await createMission({
    founderId,
    organizationId: organization.id,
    projectId: project.id,
    title: "Preschool counting worksheets",
    brief: "Research demand for printable counting worksheets on Etsy.",
  });
  await transitionMissionState(mission.id, ["draft"], "awaiting_founder_approval");
  await transitionMissionState(mission.id, ["awaiting_founder_approval"], "queued");
  await transitionMissionState(mission.id, ["queued"], "researching");
  const finalTransition = await transitionMissionState(mission.id, ["researching"], "ready_for_founders_review", {
    interpreted_mission: "Research demand for printable counting worksheets for preschoolers.",
    final_status: "ready_for_founders_review",
  });

  const evidenceRow = await recordEvidence({
    missionId: mission.id,
    sourceUrl: "https://example.com/etsy-trends",
    sourceTitle: "Etsy seller trends report",
    sourceDate: "2026-01-15",
    snippet: "Etsy allows digital downloads in several relevant categories.",
    isVerifiedFact: true,
  });

  const report = makeScoutReport({
    production_recommendation: makeProductionRecommendation(),
    ...overrides.reportOverrides,
  });
  const scout = await getAgentByKey("scout");
  await recordDeliverable({
    missionId: mission.id,
    agentId: scout!.id,
    kind: "scout_research_report",
    content: report as unknown as ScoutReport,
  });

  return { mission: finalTransition.mission, evidence: [evidenceRow], report };
}

function fakeVideoReadable(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

export type FakeVideoCall = { idempotencyKey: string; durationSeconds: number; referenceImageUrl: string; prompt: string };

/**
 * A shared fixture AsyncMediaProvider<VideoRequest> for every full-pipeline
 * test (Content Bot motion-first milestone — runVideoClipGenerationStage
 * is now a mandatory stage, so every real end-to-end pipeline test needs
 * one of these in `deps.media.video`, same as the image/voice/edit
 * fixtures each test file already provides locally). submit()/poll()
 * resolve immediately — exactly one poll round, never actually pending —
 * since these tests exercise the pipeline's own logic, not the real
 * provider's async timing (KlingVideoProvider's own submit/poll contract
 * is tested directly in tests/klingVideoProvider.test.ts).
 */
export function makeFakeVideoProvider(opts: { failWithMessage?: string } = {}): AsyncMediaProvider<VideoRequest> & { calls: FakeVideoCall[] } {
  const calls: FakeVideoCall[] = [];
  let n = 0;
  const provider: AsyncMediaProvider<VideoRequest> & { calls: FakeVideoCall[] } = {
    key: "fake-video",
    capability: "video",
    calls,
    estimateUsd: (req: VideoRequest) => Math.round(req.durationSeconds * 0.112 * 1000) / 1000,
    async submit(req: VideoRequest) {
      n += 1;
      calls.push({
        idempotencyKey: req.idempotencyKey,
        durationSeconds: req.durationSeconds,
        referenceImageUrl: req.referenceImageUrl,
        prompt: req.prompt,
      });
      return { jobHandle: JSON.stringify({ n, durationSeconds: req.durationSeconds }) };
    },
    async poll(jobHandle: string) {
      if (opts.failWithMessage) {
        return { status: "failed" as const, detail: opts.failWithMessage };
      }
      const { n: handleN, durationSeconds } = JSON.parse(jobHandle) as { n: number; durationSeconds: number };
      const result: MediaResult = {
        open: async () => fakeVideoReadable(new Uint8Array([7, 7, 7, handleN])),
        contentType: "video/mp4",
        byteSize: null,
        durationSeconds,
        width: 1080,
        height: 1920,
        providerAssetId: null,
        usage: {
          provider: "fake-video",
          model: "fake-video-model",
          unit: "seconds",
          quantity: durationSeconds,
          usdCost: provider.estimateUsd({ durationSeconds } as VideoRequest),
        },
      };
      return { status: "done" as const, result };
    },
    async generate(req: VideoRequest): Promise<MediaResult> {
      const { jobHandle } = await provider.submit(req);
      const outcome = await provider.poll(jobHandle);
      if (outcome.status !== "done" || !outcome.result) {
        throw new Error(outcome.detail ?? "fake video generation failed");
      }
      return outcome.result;
    },
    async lookup() {
      return null;
    },
  };
  return provider;
}

export function fakeAnthropicClientWithCalls(
  responses: Array<ReturnType<typeof fakeAnthropicMessage>>,
): { client: Anthropic; calls: unknown[] } {
  const calls: unknown[] = [];
  let call = 0;
  const client = {
    messages: {
      create: async (params: unknown) => {
        calls.push(params);
        const response = responses[Math.min(call, responses.length - 1)];
        call += 1;
        return response;
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}
