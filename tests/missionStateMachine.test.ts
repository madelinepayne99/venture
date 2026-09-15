import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  IllegalMissionTransitionError,
  isCancellable,
  MISSION_DOCK_BUCKETS,
  missionDockBucket,
} from "@/lib/domain/missionStates";
import { MISSION_STATES } from "@/lib/db/types";

describe("mission state machine", () => {
  it("allows the honest happy path", () => {
    expect(canTransition("draft", "awaiting_founder_approval")).toBe(true);
    expect(canTransition("awaiting_founder_approval", "queued")).toBe(true);
    expect(canTransition("queued", "researching")).toBe(true);
    expect(canTransition("researching", "ready_for_founders_review")).toBe(true);
  });

  it("allows Scout's other honest verdicts", () => {
    expect(canTransition("researching", "awaiting_evidence")).toBe(true);
    expect(canTransition("researching", "rejected")).toBe(true);
    expect(canTransition("researching", "failed")).toBe(true);
  });

  it("never allows skipping straight to a completion state — no fabricated progress", () => {
    expect(canTransition("draft", "ready_for_founders_review")).toBe(false);
    expect(canTransition("draft", "researching")).toBe(false);
    expect(canTransition("awaiting_founder_approval", "researching")).toBe(false);
    expect(canTransition("queued", "ready_for_founders_review")).toBe(false);
  });

  it("treats rejected and cancelled as terminal", () => {
    expect(canTransition("rejected", "queued")).toBe(false);
    expect(canTransition("cancelled", "queued")).toBe(false);
  });

  it("assertTransition throws IllegalMissionTransitionError on an illegal move", () => {
    expect(() => assertTransition("draft", "ready_for_founders_review")).toThrow(
      IllegalMissionTransitionError,
    );
  });

  it("allows cancellation from every active state but not from terminal ones", () => {
    expect(isCancellable("draft")).toBe(true);
    expect(isCancellable("awaiting_founder_approval")).toBe(true);
    expect(isCancellable("queued")).toBe(true);
    expect(isCancellable("researching")).toBe(true);
    expect(isCancellable("rejected")).toBe(false);
    expect(isCancellable("cancelled")).toBe(false);
  });
});

describe("missionDockBucket — the HQ view's compact mission-dock grouping", () => {
  it("maps every one of the 9 real mission states to exactly one of the 6 dock buckets", () => {
    for (const state of MISSION_STATES) {
      expect(MISSION_DOCK_BUCKETS).toContain(missionDockBucket(state));
    }
  });

  it("groups queued together with researching — both mean Scout is dispatched or working", () => {
    expect(missionDockBucket("queued")).toBe("researching");
    expect(missionDockBucket("researching")).toBe("researching");
  });

  it("groups rejected together with ready_for_founders_review under completed — both are real finished verdicts", () => {
    expect(missionDockBucket("rejected")).toBe("completed");
    expect(missionDockBucket("ready_for_founders_review")).toBe("completed");
  });

  it("groups cancelled together with failed — neither reached a real research verdict", () => {
    expect(missionDockBucket("cancelled")).toBe("failed");
    expect(missionDockBucket("failed")).toBe("failed");
  });

  it("maps draft and awaiting_founder_approval to their own distinct buckets", () => {
    expect(missionDockBucket("draft")).toBe("draft");
    expect(missionDockBucket("awaiting_founder_approval")).toBe("awaiting_approval");
  });

  it("maps awaiting_evidence to its own distinct bucket", () => {
    expect(missionDockBucket("awaiting_evidence")).toBe("awaiting_evidence");
  });
});
