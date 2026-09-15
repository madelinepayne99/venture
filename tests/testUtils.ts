import type Anthropic from "@anthropic-ai/sdk";
import type { ScoutReport } from "@/lib/agents/scout/schema";

export function makeScoutReport(overrides: Partial<ScoutReport> = {}): ScoutReport {
  return {
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
