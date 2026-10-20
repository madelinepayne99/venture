import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Background-job tenant safety (Master Development Mission 6 — "Audit
 * all Inngest/background jobs to ensure organisation ownership is
 * validated from authoritative database records, not trusted from event
 * payloads").
 *
 * The real audit: every `inngest.send()` call site in this codebase was
 * read directly (lib/domain/missionWorkflow.ts, lib/domain/
 * contentWorkflow.ts, lib/jobs/stuckMissionWatchdog.ts, lib/jobs/
 * contentWatchdogs.ts — 9 real call sites). Every one sends only real,
 * server-generated resource ids (missionId/contentItemId/approvalId) —
 * never a founderId, organizationId, or any other authorization claim.
 * Every job handler (runScoutPipeline, runContentProductionPipeline)
 * re-resolves the mission/content item from the real database by that id
 * and checks its real, authoritative organization_id wherever that
 * matters (the founder-facing functions it's reached through — see
 * Phase E and the Content Bot security pass) — nothing is ever trusted
 * from the event itself. This is safe by construction, not by discipline
 * that could silently erode: this test is the structural guard against a
 * future call site adding a trusted claim to an event payload instead of
 * re-deriving it from the database.
 */

const REPO_ROOT = path.resolve(__dirname, "..");
const SOURCE_DIRS = ["lib/domain", "lib/jobs", "lib/inngest"];
// Real resource identifiers are fine — a background job needs to know
// WHICH mission/content item to process. What must never appear is a
// claim about WHO authorized it or WHICH organization it belongs to;
// the job must re-derive both from the real database row instead.
const FORBIDDEN_KEY_PATTERN = /\b(founderId|founder_id|organizationId|organization_id|role|isOwner|isAdmin)\s*:/;

function listTsFiles(dir: string): string[] {
  const full = path.join(REPO_ROOT, dir);
  const out: string[] = [];
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const entryPath = path.join(full, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(path.join(dir, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(entryPath);
    }
  }
  return out;
}

function extractSendCallBodies(source: string): string[] {
  const bodies: string[] = [];
  const marker = "inngest.send(";
  let searchFrom = 0;
  while (true) {
    const start = source.indexOf(marker, searchFrom);
    if (start === -1) break;
    // Balanced-paren scan from the call's own opening "(" — the same
    // tolerant extraction approach this codebase already uses elsewhere
    // (see lib/agents/scout/index.ts's JSON extraction) rather than a
    // regex that can't handle nested braces/objects.
    let depth = 0;
    let i = start + marker.length - 1; // position of the opening "("
    let end = -1;
    for (; i < source.length; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) break; // malformed — stop rather than loop forever
    bodies.push(source.slice(start, end + 1));
    searchFrom = end + 1;
  }
  return bodies;
}

describe("Inngest event payloads never carry a trusted tenant/authorization claim", () => {
  it("every real inngest.send() call site sends only resource ids — no founderId/organizationId/role", () => {
    const files = SOURCE_DIRS.flatMap(listTsFiles);
    const violations: Array<{ file: string; snippet: string }> = [];
    let totalCallsChecked = 0;

    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      const calls = extractSendCallBodies(source);
      for (const call of calls) {
        totalCallsChecked += 1;
        if (FORBIDDEN_KEY_PATTERN.test(call)) {
          violations.push({ file: path.relative(REPO_ROOT, file), snippet: call.slice(0, 300) });
        }
      }
    }

    // A real sanity check on the test itself — if this ever drops to 0,
    // the extraction logic broke silently and would pass vacuously.
    expect(totalCallsChecked).toBeGreaterThanOrEqual(9);
    expect(violations).toEqual([]);
  });
});
