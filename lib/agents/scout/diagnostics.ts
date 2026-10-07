// Minimum safe diagnostic metadata for one Scout run — enough to tell a
// parse failure from a schema failure, a truncation, or a failed recovery,
// WITHOUT retaining any raw model output. Everything here is either a
// count, an enum, a token number, a validated identifier, or a Zod issue
// path/code (never an issue value or message).

export type ScoutFailureKind =
  | "no_report"
  | "json_syntax"
  | "schema_invalid"
  | "wrong_workspace"
  | "guardrail_rejected"
  | "truncated"
  | "recovery_failed"
  | "refused"
  | "paused_too_long";

export interface ScoutCallDiagnostics {
  stopReason: string | null;
  /** Content block type -> count (e.g. server_tool_use: 6). */
  blocks: Record<string, number>;
  /** Names only of client tool_use blocks, sanitized. */
  clientToolNames: string[];
  inputTokens: number;
  outputTokens: number;
}

export interface ScoutRunDiagnostics {
  calls: ScoutCallDiagnostics[];
  nudged: boolean;
  recovered: boolean;
  usedSubmitTool: boolean;
  failureKind?: ScoutFailureKind;
  /** Zod issue "path:code" pairs for schema_invalid — never values or messages. */
  issues?: string[];
}

const SAFE_NAME = /^[A-Za-z0-9_.-]{1,64}$/;

export function sanitizeToolName(name: unknown): string {
  return typeof name === "string" && SAFE_NAME.test(name) ? name : "invalid_name";
}

export function summarizeCall(
  response: { stop_reason: string | null; content: Array<{ type: string; name?: string }>; usage: { input_tokens: number; output_tokens: number } },
): ScoutCallDiagnostics {
  const blocks: Record<string, number> = {};
  const clientToolNames: string[] = [];
  for (const block of response.content) {
    blocks[block.type] = (blocks[block.type] ?? 0) + 1;
    if (block.type === "tool_use") clientToolNames.push(sanitizeToolName(block.name));
  }
  return {
    stopReason: response.stop_reason,
    blocks,
    clientToolNames,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

/** Compact one-line JSON, hard-capped so it can never bloat an activity row. */
export function formatDiagnostics(diagnostics: ScoutRunDiagnostics): string {
  const text = JSON.stringify(diagnostics);
  return text.length > 1200 ? `${text.slice(0, 1200)}…(truncated)` : text;
}
