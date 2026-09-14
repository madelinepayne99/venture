import { describe, expect, it } from "vitest";
import { MISSION_STATES } from "@/lib/db/types";
import { MISSION_STATE_LABELS } from "@/lib/domain/missionStates";
import fs from "node:fs";
import path from "node:path";

// These tests exist to keep a specific promise from the product brief: the
// interface must never show a fabricated progress percentage, and a
// mission can never appear "done" without actually having gone through
// research.

describe("no fabricated progress", () => {
  it("the mission state vocabulary is exactly the nine honest states — no numeric progress state", () => {
    const states = [...MISSION_STATES].sort();
    const expected = [
      "awaiting_evidence",
      "awaiting_founder_approval",
      "cancelled",
      "draft",
      "failed",
      "queued",
      "ready_for_founders_review",
      "rejected",
      "researching",
    ].sort();
    expect(states).toEqual(expected);
    expect(Object.keys(MISSION_STATE_LABELS).length).toBe(9);
  });

  it("no source file renders a hardcoded completion percentage for missions", () => {
    const searchRoots = ["app", "components", "lib"].map((p) => path.join(process.cwd(), p));
    const offenders: string[] = [];

    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
          const content = fs.readFileSync(fullPath, "utf-8");
          if (/progress\s*[:=]\s*\d/i.test(content) || /%\s*complete/i.test(content)) {
            offenders.push(fullPath);
          }
        }
      }
    }

    for (const root of searchRoots) walk(root);
    expect(offenders).toEqual([]);
  });

  it("the schema records only real, discrete stage statuses — not a percentage column", () => {
    const schema = fs.readFileSync(path.join(process.cwd(), "lib", "db", "schema.ts"), "utf-8");
    expect(schema).not.toMatch(/percent/i);
    expect(schema).not.toMatch(/progress_pct/i);
  });
});
