import { describe, expect, it } from "vitest";
import { toApiErrorResponse } from "@/lib/api/errors";

describe("secret protection", () => {
  it("refuses to build an Anthropic client when no API key is configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { getAnthropicClient } = await import("@/lib/agents/anthropicClient");
    expect(() => getAnthropicClient()).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("never forwards a raw, unrecognized error message to the API response", async () => {
    const secretLookingError = new Error("connect failed with key sk-ant-api03-totally-real-secret");
    const response = toApiErrorResponse(secretLookingError);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toMatch(/sk-ant-api03/);
    expect(body.error).toBe("Something went wrong handling that request.");
  });

  it("the .env.example file never assigns a real value to a credential-shaped variable", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const content = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf-8");
    const lines = content.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"));
    const credentialPattern = /KEY|SECRET|TOKEN|PASSWORD/i;
    for (const line of lines) {
      const [key, value] = line.split("=");
      if (credentialPattern.test(key ?? "")) {
        expect((value ?? "").trim()).toBe("");
      }
    }
  });
});
