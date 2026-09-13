import { describe, expect, it } from "vitest";
import { validateMissionInput } from "@/lib/domain/missionValidation";

describe("validateMissionInput", () => {
  it("accepts a well-formed mission", () => {
    const result = validateMissionInput({
      title: "Preschool counting worksheets",
      brief: "Research demand for printable counting worksheets for 3-5 year olds on Etsy.",
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects a missing title", () => {
    const result = validateMissionInput({ brief: "A brief that is definitely long enough." });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/title/i);
  });

  it("rejects a missing brief", () => {
    const result = validateMissionInput({ title: "Something" });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/brief/i);
  });

  it("rejects a brief too short to research", () => {
    const result = validateMissionInput({ title: "Something", brief: "too short" });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/too short/i);
  });

  it("rejects a title over the length limit", () => {
    const result = validateMissionInput({
      title: "x".repeat(200),
      brief: "A brief that is definitely long enough to pass validation.",
    });
    expect(result.valid).toBe(false);
  });

  it("trims whitespace before checking emptiness", () => {
    const result = validateMissionInput({ title: "   ", brief: "   " });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });
});
