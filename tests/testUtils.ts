import type Anthropic from "@anthropic-ai/sdk";
import type { CommerceReport, ServiceBusinessReport, ProductionRecommendation, ScoutReport } from "@/lib/agents/scout/schema";
import type { ProductionBrief } from "@/lib/domain/contentHandoff";
import type { AudienceContext } from "@/lib/media/types";
import type { ContentPlan } from "@/lib/agents/contentBot/schema";
import type { Evidence, Mission } from "@/lib/db/types";
import {
  createProject,
  createMission,
  transitionMissionState,
  recordEvidence,
  recordDeliverable,
  getAgentByKey,
} from "@/lib/db/repositories";

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
    script: [
      {
        index: 0,
        narration: "Here are five counting games you can print at home today.",
        visual_direction: "A bright, original illustration of counting worksheets on a table.",
        start_seconds: 0,
        end_seconds: 5,
      },
      {
        index: 1,
        narration: "Etsy sellers already offer digital downloads like this.",
        visual_direction: "An original illustration of a laptop showing a generic marketplace-style page.",
        start_seconds: 5,
        end_seconds: 10,
      },
    ],
    claims: [{ text: "Etsy allows digital downloads in several relevant categories.", evidence_id: "evidence-1" }],
    thumbnail_brief: { prompt: "A bright original illustration of counting worksheets.", text_overlay: "5 Counting Games" },
    voice_direction: { pace: "natural" },
    originality_statement: "This is an original execution — no specific existing video, character, or work is reproduced.",
    ...overrides,
  };
}

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
  const project = await createProject({ name: "Digital Products (test)", workspaceType: "commerce" });
  const mission = await createMission({
    founderId,
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
