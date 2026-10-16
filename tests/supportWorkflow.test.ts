import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import { createFounder } from "@/lib/db/repositories";
import { createOrganizationWithOwner } from "@/lib/domain/organizationWorkflow";
import {
  submitSupportRequest,
  listMySupportRequests,
  SupportRequestValidationError,
  SupportRequestRateLimitError,
  getSupportContactAddress,
  isEmailDeliveryConfigured,
} from "@/lib/domain/supportWorkflow";

describe("submitSupportRequest", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("creates a real, persisted support request", async () => {
    const founder = await createFounder({ name: "Support Tester" });
    const { organization } = await createOrganizationWithOwner(founder.id, "Support Co");

    const request = await submitSupportRequest({
      founderId: founder.id,
      organizationId: organization.id,
      subject: "Billing question",
      message: "How do I change my plan?",
    });

    expect(request.subject).toBe("Billing question");
    expect(request.status).toBe("open");

    const mine = await listMySupportRequests(founder.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.id).toBe(request.id);
  });

  it("rejects an empty subject or message", async () => {
    const founder = await createFounder({ name: "Support Tester" });
    await expect(
      submitSupportRequest({ founderId: founder.id, organizationId: null, subject: "", message: "hello" }),
    ).rejects.toThrow(SupportRequestValidationError);
    await expect(
      submitSupportRequest({ founderId: founder.id, organizationId: null, subject: "hello", message: "   " }),
    ).rejects.toThrow(SupportRequestValidationError);
  });

  it("rejects an oversized subject or message", async () => {
    const founder = await createFounder({ name: "Support Tester" });
    await expect(
      submitSupportRequest({
        founderId: founder.id,
        organizationId: null,
        subject: "x".repeat(300),
        message: "hello",
      }),
    ).rejects.toThrow(SupportRequestValidationError);
    await expect(
      submitSupportRequest({
        founderId: founder.id,
        organizationId: null,
        subject: "hello",
        message: "x".repeat(6000),
      }),
    ).rejects.toThrow(SupportRequestValidationError);
  });

  it("works with no organization (e.g. a founder mid-onboarding)", async () => {
    const founder = await createFounder({ name: "Pre-onboarding Founder" });
    const request = await submitSupportRequest({
      founderId: founder.id,
      organizationId: null,
      subject: "Can't finish onboarding",
      message: "Stuck on step 2.",
    });
    expect(request.organization_id).toBeNull();
  });

  it("rate-limits a founder submitting too many requests too quickly", async () => {
    const founder = await createFounder({ name: "Spammer" });
    for (let i = 0; i < 5; i++) {
      await submitSupportRequest({
        founderId: founder.id,
        organizationId: null,
        subject: `Request ${i}`,
        message: "Real message content.",
      });
    }
    await expect(
      submitSupportRequest({ founderId: founder.id, organizationId: null, subject: "One too many", message: "Real message content." }),
    ).rejects.toThrow(SupportRequestRateLimitError);
  });

  it("never leaks another founder's support requests", async () => {
    const founderA = await createFounder({ name: "Founder A" });
    const founderB = await createFounder({ name: "Founder B" });
    await submitSupportRequest({ founderId: founderA.id, organizationId: null, subject: "A's issue", message: "Real message." });
    await submitSupportRequest({ founderId: founderB.id, organizationId: null, subject: "B's issue", message: "Real message." });

    const mineA = await listMySupportRequests(founderA.id);
    expect(mineA).toHaveLength(1);
    expect(mineA[0]!.subject).toBe("A's issue");
  });
});

describe("getSupportContactAddress / isEmailDeliveryConfigured", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null when SUPPORT_CONTACT_EMAIL is unset — never a fabricated address", () => {
    vi.stubEnv("SUPPORT_CONTACT_EMAIL", "");
    expect(getSupportContactAddress()).toBeNull();
  });

  it("returns the real configured address when set", () => {
    vi.stubEnv("SUPPORT_CONTACT_EMAIL", "support@example.test");
    expect(getSupportContactAddress()).toBe("support@example.test");
  });

  it("never claims email delivery is configured without a real provider key", () => {
    vi.stubEnv("SUPPORT_EMAIL_PROVIDER_API_KEY", "");
    expect(isEmailDeliveryConfigured()).toBe(false);
  });

  afterAll(() => {
    process.env = originalEnv;
  });
});
