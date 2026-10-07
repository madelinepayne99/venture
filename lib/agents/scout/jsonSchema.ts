import { z, type ZodTypeAny } from "zod";
import type { WorkspaceType } from "@/lib/db/types";
import { CommerceReportSchema, ServiceBusinessReportSchema } from "./schema";

// Derives the JSON Schema for Scout's `submit_scout_report` tool DIRECTLY
// from the Zod report schemas, so the provider-enforced (strict) shape can
// never drift from the app-side validation that still runs on whatever
// comes back. Deliberately covers only the Zod constructs schema.ts uses.
//
// Strict tool schemas don't support length/size constraints (min/max items,
// string lengths, formats) — those are simply omitted here and remain
// enforced application-side by the Zod schema, exactly as before. Fields
// with a Zod `.default()` are listed as `required` in the tool schema (the
// model is always asked for them; Zod still tolerates their absence), so the
// only optional property is `production_recommendation` — which Scout must
// remain free to omit.

export type JsonSchema = Record<string, unknown>;

function describe(schema: ZodTypeAny, out: JsonSchema): JsonSchema {
  if (schema.description) out.description = schema.description;
  return out;
}

function unwrap(schema: ZodTypeAny): { inner: ZodTypeAny; optional: boolean } {
  let inner = schema;
  let optional = false;
  for (;;) {
    const name = inner._def.typeName as string;
    if (name === "ZodOptional") {
      optional = true;
      inner = inner._def.innerType;
    } else if (name === "ZodDefault") {
      inner = inner._def.innerType;
    } else {
      return { inner, optional };
    }
  }
}

export function zodToStrictJsonSchema(schema: ZodTypeAny): JsonSchema {
  const { inner } = unwrap(schema);
  const def = inner._def;
  const typeName = def.typeName as string;

  switch (typeName) {
    case "ZodString":
      return describe(schema, describe(inner, { type: "string" }));
    case "ZodNumber":
      return describe(schema, describe(inner, { type: "number" }));
    case "ZodBoolean":
      return describe(schema, describe(inner, { type: "boolean" }));
    case "ZodLiteral":
      return describe(schema, { type: "string", enum: [def.value] });
    case "ZodEnum":
      return describe(schema, { type: "string", enum: [...def.values] });
    case "ZodNullable":
      return describe(schema, { anyOf: [zodToStrictJsonSchema(def.innerType), { type: "null" }] });
    case "ZodArray":
      return describe(schema, { type: "array", items: zodToStrictJsonSchema(def.type) });
    case "ZodObject": {
      const shape = (inner as z.ZodObject<z.ZodRawShape>).shape;
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToStrictJsonSchema(value as ZodTypeAny);
        if (!unwrap(value as ZodTypeAny).optional) required.push(key);
      }
      return describe(schema, { type: "object", properties, required, additionalProperties: false });
    }
    default:
      throw new Error(`zodToStrictJsonSchema: unsupported Zod type "${typeName}" — extend the converter deliberately.`);
  }
}

export const SUBMIT_REPORT_TOOL_NAME = "submit_scout_report";

/** The report Zod schema for one workspace's variant (the tool's root must be a plain object, so no union). */
export function reportSchemaForWorkspace(workspaceType: WorkspaceType): ZodTypeAny {
  return workspaceType === "service_business" ? ServiceBusinessReportSchema : CommerceReportSchema;
}

/**
 * Scout's ONLY client-defined tool. Calling it is how Scout delivers its
 * final report — a strict tool input is schema-valid by construction, so the
 * report no longer depends on the model choosing to write parseable JSON as
 * free text. The tool is never "executed": a call to it ends the run, and
 * the input still goes through the full Zod schema, workspace check and
 * every guardrail (defense in depth).
 */
export function buildSubmitReportTool(workspaceType: WorkspaceType) {
  return {
    name: SUBMIT_REPORT_TOOL_NAME,
    description:
      "Deliver your FINAL, complete research report. Call this exactly once, only when your research " +
      "is finished, with the complete report as the input. Do not write the report as text instead.",
    strict: true,
    input_schema: zodToStrictJsonSchema(reportSchemaForWorkspace(workspaceType)),
  };
}
