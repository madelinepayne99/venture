import { describe, expect, it } from "vitest";
import { runScoutResearch, ScoutResearchError } from "@/lib/agents/scout";
import { buildSubmitReportTool, SUBMIT_REPORT_TOOL_NAME, zodToStrictJsonSchema, reportSchemaForWorkspace } from "@/lib/agents/scout/jsonSchema";
import { formatDiagnostics } from "@/lib/agents/scout/diagnostics";
import type { Mission } from "@/lib/db/types";
import {
  fakeAnthropicClientWithCalls,
  fakeAnthropicMessage,
  makeScoutReport,
  makeServiceBusinessReport,
} from "./testUtils";

function makeMission(): Mission {
  return {
    id: "mission-1",
    project_id: null,
    founder_id: "founder-1",
    title: "Kids shadow explainer",
    brief: "Research one original 30-second video.",
    interpreted_mission: null,
    state: "researching",
    final_status: null,
    failure_reason: null,
    research_pass_count: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as Mission;
}

function submitResponse(input: unknown, overrides: Record<string, unknown> = {}) {
  return fakeAnthropicMessage(null, {
    stop_reason: "tool_use",
    content: [
      { type: "text", text: "I'll now compile the final structured report.", citations: null },
      { type: "tool_use", id: "toolu_submit", name: SUBMIT_REPORT_TOOL_NAME, input },
    ],
    ...overrides,
  });
}

// The exact live failure shape (ACCEPTANCE 3): searches, narration, then a
// stray client tool_use and stop_reason "tool_use" — no report anywhere.
function strayToolUseResponse(name = "some_unknown_tool") {
  return fakeAnthropicMessage(null, {
    stop_reason: "tool_use",
    content: [
      { type: "server_tool_use", id: "srv1", name: "web_search", input: { query: "q" } },
      { type: "web_search_tool_result", tool_use_id: "srv1", content: [] },
      { type: "text", text: "I now have enough evidence to compile the report.", citations: null },
      { type: "tool_use", id: "toolu_stray", name, input: {} },
    ],
  });
}

describe("submit_scout_report — the report is delivered as a strict tool call", () => {
  it("accepts a report delivered via the tool, validates it, and sends the strict tool alongside web_search", async () => {
    const { client, calls } = fakeAnthropicClientWithCalls([submitResponse(makeScoutReport())]);

    const outcome = await runScoutResearch(makeMission(), { client });

    expect(calls).toHaveLength(1);
    expect(outcome.report.verdict).toBe("ready_for_founders_review");
    const request = calls[0] as { tools: Array<Record<string, unknown>>; tool_choice?: unknown };
    expect(request.tool_choice).toBeUndefined(); // never forced
    const names = request.tools.map((t) => t.name);
    expect(names).toEqual(["web_search", SUBMIT_REPORT_TOOL_NAME]);
    expect(request.tools[1]?.strict).toBe(true);
  });

  it("still applies full schema validation to the tool's input (defense in depth) and reports issue paths only", async () => {
    const { client } = fakeAnthropicClientWithCalls([submitResponse({ ...makeScoutReport(), verdict: "definitely" })]);

    let caught: unknown;
    try {
      await runScoutResearch(makeMission(), { client });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ScoutResearchError);
    const err = caught as ScoutResearchError;
    expect(err.message).toMatch(/structural validation/i);
    expect(err.diagnostics?.failureKind).toBe("schema_invalid");
    expect(err.diagnostics?.usedSubmitTool).toBe(true);
    expect(err.diagnostics?.issues?.some((i) => i.startsWith("verdict:"))).toBe(true);
    expect(formatDiagnostics(err.diagnostics!)).not.toMatch(/definitely/); // never a value
  });

  it("applies the same guarantee-language and evidence guardrails to a tool-delivered report", async () => {
    const bad = makeScoutReport({ evidence_of_demand: "This product is guaranteed to sell well." });
    const { client } = fakeAnthropicClientWithCalls([submitResponse(bad)]);
    await expect(runScoutResearch(makeMission(), { client })).rejects.toThrow(/prohibited certainty language/i);

    const weak = makeScoutReport({ verdict: "ready_for_founders_review", sources: [], verified_facts: [] });
    const outcome = await runScoutResearch(makeMission(), {
      client: fakeAnthropicClientWithCalls([submitResponse(weak)]).client,
    });
    expect(outcome.report.verdict).toBe("investigate_further");
  });

  it("does not force a production_recommendation, and Scout can still decline or reject", async () => {
    const withoutRec = makeScoutReport();
    expect("production_recommendation" in withoutRec).toBe(false);
    const a = await runScoutResearch(makeMission(), { client: fakeAnthropicClientWithCalls([submitResponse(withoutRec)]).client });
    expect(a.report.production_recommendation).toBeUndefined();

    const rejected = makeScoutReport({ verdict: "reject", verdict_rationale: "Saturated; not worth producing." });
    const b = await runScoutResearch(makeMission(), { client: fakeAnthropicClientWithCalls([submitResponse(rejected)]).client });
    expect(b.report.verdict).toBe("reject");
  });

  it("uses the identical mechanism for a follow-up pass and for a Service Business report", async () => {
    const followup = fakeAnthropicClientWithCalls([submitResponse(makeScoutReport())]);
    await runScoutResearch(makeMission(), {
      client: followup.client,
      followupContext: {
        passNumber: 2,
        maxPasses: 2,
        priorVerdictRationale: "r",
        unresolvedQuestions: ["q"],
        priorVerifiedFacts: [],
        priorSources: [],
      },
    });
    const followupTools = (followup.calls[0] as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    expect(followupTools).toContain(SUBMIT_REPORT_TOOL_NAME);

    const service = fakeAnthropicClientWithCalls([submitResponse(makeServiceBusinessReport())]);
    const outcome = await runScoutResearch(makeMission(), { client: service.client, workspaceType: "service_business" });
    expect(outcome.report.workspace_type).toBe("service_business");
    const tool = (service.calls[0] as { tools: Array<{ name: string; input_schema: { properties: Record<string, unknown> } }> }).tools[1]!;
    expect(tool.input_schema.properties).toHaveProperty("regulatory_and_compliance_notes");
    expect(tool.input_schema.properties).not.toHaveProperty("platform_suitability");
  });

  it("still accepts a plain JSON text report as a fallback (no tool call)", async () => {
    const { client, calls } = fakeAnthropicClientWithCalls([fakeAnthropicMessage(makeScoutReport())]);
    const outcome = await runScoutResearch(makeMission(), { client });
    expect(calls).toHaveLength(1);
    expect(outcome.report.verdict).toBe("ready_for_founders_review");
  });
});

describe("live ACCEPTANCE 3 regression — a turn that ends on a stray client tool_use", () => {
  it("answers the stray tool_use with a matching tool_result (protocol-valid) plus the format nudge, then accepts the submitted report", async () => {
    const { client, calls } = fakeAnthropicClientWithCalls([strayToolUseResponse(), submitResponse(makeScoutReport())]);

    const outcome = await runScoutResearch(makeMission(), { client });

    expect(calls).toHaveLength(2);
    expect(outcome.usage.inputTokens).toBe(2000);
    const second = calls[1] as { messages: Array<{ role: string; content: unknown }> };
    const last = second.messages.at(-1)!;
    expect(last.role).toBe("user");
    const parts = last.content as Array<Record<string, unknown>>;
    // The tool_result for the stray call comes first, then the nudge text.
    expect(parts[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_stray", is_error: true });
    expect(parts.at(-1)).toMatchObject({ type: "text" });
    expect(String(parts.at(-1)?.text)).toMatch(/submit_scout_report/);
    // The prior assistant turn (with its search results) stays in context.
    expect(second.messages.at(-2)?.role).toBe("assistant");
  });

  it("is bounded: a second report-less turn fails after exactly one nudge, with safe diagnostics and no raw text", async () => {
    const { client, calls } = fakeAnthropicClientWithCalls([strayToolUseResponse("mystery_tool"), strayToolUseResponse("mystery_tool")]);

    let caught: unknown;
    try {
      await runScoutResearch(makeMission(), { client });
    } catch (error) {
      caught = error;
    }

    expect(calls).toHaveLength(2);
    const err = caught as ScoutResearchError;
    expect(err).toBeInstanceOf(ScoutResearchError);
    expect(err.message).toMatch(/not valid JSON/i);
    expect(err.usage.inputTokens).toBe(2000);
    expect(err.diagnostics).toMatchObject({ nudged: true, usedSubmitTool: false, failureKind: "no_report" });
    expect(err.diagnostics?.calls).toHaveLength(2);
    expect(err.diagnostics?.calls[0]).toMatchObject({
      stopReason: "tool_use",
      clientToolNames: ["mystery_tool"],
      blocks: { server_tool_use: 1, web_search_tool_result: 1, text: 1, tool_use: 1 },
    });
    const line = formatDiagnostics(err.diagnostics!);
    expect(line).not.toMatch(/enough evidence to compile/); // raw model text is never retained
    expect(line.length).toBeLessThanOrEqual(1250);
  });

  it("sanitizes a hostile tool name in diagnostics", async () => {
    const { client } = fakeAnthropicClientWithCalls([strayToolUseResponse('<script>alert(1)</script>'), strayToolUseResponse()]);
    const err = (await runScoutResearch(makeMission(), { client }).catch((e) => e)) as ScoutResearchError;
    expect(err.diagnostics?.calls[0]?.clientToolNames).toEqual(["invalid_name"]);
  });
});

describe("zodToStrictJsonSchema / buildSubmitReportTool", () => {
  type Schema = Record<string, unknown>;
  const UNSUPPORTED = ["minLength", "maxLength", "minItems", "maxItems", "minimum", "maximum", "format", "pattern"];

  function walk(node: Schema, visit: (n: Schema) => void) {
    visit(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach((v) => v && typeof v === "object" && walk(v as Schema, visit));
      else if (value && typeof value === "object") walk(value as Schema, visit);
    }
  }

  // Minimal validator for the subset the converter emits — proves real sample
  // reports conform to the generated schema (no drift from the Zod source).
  function conforms(value: unknown, schema: Schema): boolean {
    if (schema.anyOf) return (schema.anyOf as Schema[]).some((s) => conforms(value, s));
    switch (schema.type) {
      case "null": return value === null;
      case "string": return typeof value === "string" && (!schema.enum || (schema.enum as string[]).includes(value));
      case "array": return Array.isArray(value) && value.every((v) => conforms(v, schema.items as Schema));
      case "object": {
        if (!value || typeof value !== "object") return false;
        const obj = value as Record<string, unknown>;
        const props = schema.properties as Record<string, Schema>;
        if (Object.keys(obj).some((k) => !(k in props))) return false;
        return ((schema.required as string[]) ?? []).every((k) => k in obj) &&
          Object.entries(obj).every(([k, v]) => conforms(v, props[k]!));
      }
      default: return false;
    }
  }

  for (const workspaceType of ["commerce", "service_business"] as const) {
    it(`${workspaceType}: root is a plain object, every object is closed, and no unsupported constraint keywords appear`, () => {
      const schema = buildSubmitReportTool(workspaceType).input_schema as Schema;
      expect(schema.type).toBe("object");
      expect(schema.anyOf).toBeUndefined();
      walk(schema, (n) => {
        if (n.type === "object") expect(n.additionalProperties).toBe(false);
        for (const key of UNSUPPORTED) expect(n).not.toHaveProperty(key);
      });
    });

    it(`${workspaceType}: production_recommendation is the ONLY optional property, so Scout can omit it`, () => {
      const schema = buildSubmitReportTool(workspaceType).input_schema as { properties: Record<string, unknown>; required: string[] };
      const optional = Object.keys(schema.properties).filter((k) => !schema.required.includes(k));
      expect(optional).toEqual(["production_recommendation"]);
    });
  }

  it("real sample reports (with and without a production recommendation) conform to the generated schema", () => {
    const commerce = zodToStrictJsonSchema(reportSchemaForWorkspace("commerce")) as Schema;
    const service = zodToStrictJsonSchema(reportSchemaForWorkspace("service_business")) as Schema;
    expect(conforms(makeScoutReport(), commerce)).toBe(true);
    expect(conforms(makeServiceBusinessReport(), service)).toBe(true);
    expect(conforms({ ...makeScoutReport(), verdict: "definitely" }, commerce)).toBe(false);
    expect(conforms(makeServiceBusinessReport(), commerce)).toBe(false);
  });
});
