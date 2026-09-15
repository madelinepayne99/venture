import type Anthropic from "@anthropic-ai/sdk";
import type { CommerceReport, ServiceBusinessReport } from "@/lib/agents/scout/schema";

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
