import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  IllegalMissionTransitionError,
  isCancellable,
} from "@/lib/domain/missionStates";

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
