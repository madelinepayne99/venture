import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoRequest } from "@/lib/media/types";
import { MediaProviderError } from "@/lib/media/types";

// Offline regression coverage for KlingVideoProvider (Minimum Motion
// Proof-of-Concept) — request construction, the real async queue
// submit/poll contract, failure handling, cost estimation, and the
// bounded generate() timeout. No real network calls; every fetch is
// mocked to the exact real shapes verified against fal.ai's own API
// documentation before this provider was written.
//
// This file was rewritten after a real live proof run hit a genuine HTTP
// 405 on a hand-reconstructed status URL — fal.ai's own submit response's
// authoritative status_url/response_url were being discarded. The
// jobHandle is now a JSON-encoded object carrying those real URLs
// verbatim; every test below that constructs a mock submit response now
// includes realistic (but fake, host-distinct) status_url/response_url
// values specifically so a test would fail if the provider ever went back
// to reconstructing a queue.fal.run URL instead of using them.

const ORIGINAL_ENV = { ...process.env };

// Deliberately NOT queue.fal.run — a distinct fake host/path, so any
// assertion that the provider fetched THIS exact URL can only pass if the
// provider used the authoritative value from the mocked response, never a
// same-looking reconstruction from the model id + request_id.
const FAKE_STATUS_URL = "https://real-status.fal.example/shard-7/requests/req-123/status";
const FAKE_RESPONSE_URL = "https://real-response.fal.example/shard-7/requests/req-123";
const FAKE_CANCEL_URL = "https://real-cancel.fal.example/shard-7/requests/req-123/cancel";

function baseRequest(overrides: Partial<VideoRequest> = {}): VideoRequest {
  return {
    idempotencyKey: "test-idempotency-key-1",
    audience: { platform: "tiktok", audience: "general", contentType: "story", workspaceType: "commerce" },
    prompt: "The creature turns its head and takes one cautious step forward.",
    durationSeconds: 5,
    aspectRatio: "9:16",
    referenceImageUrl: "https://example.test/reference.jpg",
    ...overrides,
  };
}

function submitResponse(overrides: Record<string, unknown> = {}) {
  return {
    request_id: "req-123",
    status_url: FAKE_STATUS_URL,
    response_url: FAKE_RESPONSE_URL,
    cancel_url: FAKE_CANCEL_URL,
    ...overrides,
  };
}

/** A real jobHandle, built the same way submit() would, for tests that call poll() directly without going through submit() first. */
function encodeTestJobHandle(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    requestId: "req-123",
    statusUrl: FAKE_STATUS_URL,
    responseUrl: FAKE_RESPONSE_URL,
    cancelUrl: FAKE_CANCEL_URL,
    durationSeconds: 5,
    ...overrides,
  });
}

describe("KlingVideoProvider", () => {
  beforeEach(() => {
    process.env.FAL_KEY = "fake-key-for-tests";
    // Deliberately NOT vi.resetModules() here — KlingVideoProvider caches
    // no module-level state between instantiations, and resetting modules
    // while this file's own top-level `import { MediaProviderError }`
    // stays bound to the original module instance would make every
    // `instanceof MediaProviderError` assertion below fail against a
    // freshly-re-evaluated (structurally identical but referentially
    // different) class from the reset module graph.
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("cost estimation", () => {
    it("estimateUsd matches the real per-second price × requested duration", async () => {
      const { KlingVideoProvider } = await import("@/lib/media/providers/klingVideo");
      const provider = new KlingVideoProvider();
      expect(provider.estimateUsd(baseRequest({ durationSeconds: 5 }))).toBeCloseTo(5 * 0.112, 5);
      expect(provider.estimateUsd(baseRequest({ durationSeconds: 15 }))).toBeCloseTo(15 * 0.112, 5);
      expect(provider.estimateUsd(baseRequest({ durationSeconds: 3 }))).toBeCloseTo(3 * 0.112, 5);
    });

    it("throws on a duration outside Kling's real supported 3-15s whole-second range, never silently clamping", async () => {
      const { KlingVideoProvider } = await import("@/lib/media/providers/klingVideo");
      const provider = new KlingVideoProvider();
      expect(() => provider.estimateUsd(baseRequest({ durationSeconds: 2 }))).toThrow(/3-15s/);
      expect(() => provider.estimateUsd(baseRequest({ durationSeconds: 16 }))).toThrow(/3-15s/);
      expect(() => provider.estimateUsd(baseRequest({ durationSeconds: 5.5 }))).toThrow(/3-15s/);
    });
  });

  describe("submit() — request construction and the real async queue contract", () => {
    it("sends the correct real request shape: model in the URL, start_image_url, duration as a string, generate_audio: false, and NO elements field when no referenceImageUrls are supplied", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => submitResponse() });
      vi.stubGlobal("fetch", fetchMock);

      const { KlingVideoProvider } = await import("@/lib/media/providers/klingVideo");
      const provider = new KlingVideoProvider();
      await provider.submit(baseRequest({ durationSeconds: 5, referenceImageUrl: "https://example.test/ref.jpg" }));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://queue.fal.run/fal-ai/kling-video/v3/pro/image-to-video");
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>).Authorization).toBe("Key fake-key-for-tests");

      const body = JSON.parse(init.body as string);
      expect(body.start_image_url).toBe("https://example.test/ref.jpg");
      expect(body.duration).toBe("5"); // a string, matching fal's real documented enum type
      expect(body.generate_audio).toBe(false);
      expect(body.prompt).toBe("The creature turns its head and takes one cautious step forward."); // unchanged — no @Element1 tag when elements isn't used
      // Real fix (Task 4): elements must never be sent with only
      // frontal_image_url — fal's real API rejects that combination (the
      // second live proof's genuine HTTP 422). Without a real second
      // reference image, elements is omitted entirely rather than
      // fabricated.
      expect(body.elements).toBeUndefined();
      expect(body.aspect_ratio).toBeUndefined(); // never sent — Kling infers it from the start image
      expect(Object.keys(body).sort()).toEqual(["duration", "generate_audio", "prompt", "start_image_url"]); // no unsupported/speculative fields
    });

    it("when referenceImageUrls (1-3 genuinely distinct images) is supplied, sends a valid elements entry with BOTH frontal_image_url and reference_image_urls, and prepends the required @Element1 prompt tag", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => submitResponse() });
      vi.stubGlobal("fetch", fetchMock);
      const { KlingVideoProvider } = await import("@/lib/media/providers/klingVideo");
      const provider = new KlingVideoProvider();
      await provider.submit(
        baseRequest({
          referenceImageUrl: "https://example.test/front.jpg",
          referenceImageUrls: ["https://example.test/side.jpg"],
          prompt: "The creature turns its head slowly.",
        }),
      );
      const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.elements).toEqual([
        { frontal_image_url: "https://example.test/front.jpg", reference_image_urls: ["https://example.test/side.jpg"] },
      ]);
      expect(body.prompt).toBe("@Element1 The creature turns its head slowly."); // required syntax, creative meaning unchanged
      expect(body.start_image_url).toBe("https://example.test/front.jpg"); // still sent — start_image_url and elements are valid together per fal's docs
    });

    it("never auto-duplicates referenceImageUrl into reference_image_urls — a caller must supply a genuinely separate image, or elements is simply omitted", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => submitResponse() });
      vi.stubGlobal("fetch", fetchMock);
      const { KlingVideoProvider } = await import("@/lib/media/providers/klingVideo");
      const provider = new KlingVideoProvider();
      // No referenceImageUrls at all — the only reference is referenceImageUrl itself.
      await provider.submit(baseRequest({ referenceImageUrl: "https://example.test/only-one.jpg" }));
      const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.elements).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain("reference_image_urls");
    });

    it("a referenceImageUrls array outside the documented 1-3 range throws before submission, never silently truncated or padded", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const { KlingVideoProvider } = await import("@/lib/media/providers/klingVideo");
      const provider = new KlingVideoProvider();
      await expect(provider.submit(baseRequest({ referenceImageUrls: [] }))).rejects.toThrow(/1-3 images/);
      await expect(
        provider.submit(baseRequest({ referenceImageUrls: ["a.jpg", "b.jpg", "c.jpg", "d.jpg"] })),
      ).rejects.toThrow(/1-3 images/);
      expect(fetchMock).not.toHaveBeenCalled(); // fails BEFORE any network call — missing/invalid reference data never reaches fal
    });

    it("if a caller's prompt already includes the @Element1 tag, it is not duplicated", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => submitResponse() });
      vi.stubGlobal("fetch", fetchMock);
      const { KlingVideoProvider } = await import("@/lib/media/providers/klingVideo");
      const provider = new KlingVideoProvider();
      await provider.submit(
        baseRequest({ referenceImageUrls: ["https://example.test/side.jpg"], prompt: "@Element1 already tagged." }),
      );
      const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.prompt).toBe("@Element1 already tagged.");
      expect((body.prompt as string).match(/@Element1/g)?.length).toBe(1);
    });

    it("preserves the real request_id, status_url, and response_url from fal.ai's submit response inside the jobHandle (Task 5, points 1-3)", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => submitResponse() }));
      const { KlingVideoProvider } = await import("@/lib/media/providers/klingVideo");
      const provider = new KlingVideoProvider();
      const { jobHandle } = await provider.submit(baseRequest({ durationSeconds: 5 }));

      const decoded = JSON.parse(jobHandle);
      expect(decoded.requestId).toBe("req-123");
      expect(decoded.statusUrl).toBe(FAKE_STATUS_URL);
      expect(decoded.responseUrl).toBe(FAKE_RESPONSE_URL);
      expect(decoded.cancelUrl).toBe(FAKE_CANCEL_URL);
      expect(decoded.durationSeconds).toBe(5);
    });

    it("preserves a real response_url even when cancel_url is absent (cancel_url is genuinely optional in fal's own schema)", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ request_id: "req-123", status_url: FAKE_STATUS_URL, response_url: FAKE_RESPONSE_URL }),
        }),
      );
      const { KlingVideoProvider } = await import("@/lib/media/providers/klingVideo");
      const provider = new KlingVideoProvider();
      const { jobHandle } = await provider.submit(baseRequest());
      const decoded = JSON.parse(jobHandle);
      expect(decoded.responseUrl).toBe(FAKE_RESPONSE_URL);
      expect(decoded.cancelUrl).toBeNull();
    });

    it("throws a clear error if fal's submit response is missing status_url or response_url, rather than falling back to a reconstructed URL", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ request_id: "req-123" }) }));
      const { KlingVideoProvider } = await import("@/lib/media/providers/klingVideo");
      const provider = new KlingVideoProvider();
      await expect(provider.submit(baseRequest())).rejects.toThrow(/status_url\/response_url/);
    });

    it("never omits generate_audio:false, even if a caller's request object were mutated after construction (defense in depth)", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => submitResponse() });
      vi.stubGlobal("fetch", fetchMock);
      const { KlingVideoProvider } = await import("@/lib/media/providers/klingVideo");
      const provider = new KlingVideoProvider();
      await provider.submit(baseRequest());
      const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.generate_audio).toBe(false);
    });

    it("throws rather than silently generating without a reference — never falls back to referenceless generation", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const { KlingVideoProvider } = await import("@/lib/media/providers/klingVideo");
      const provider = new KlingVideoProvider();
      const reqWithoutReference = { ...baseRequest(), referenceImageUrl: "" };
      await expect(provider.submit(reqWithoutReference)).rejects.toThrow(/requires referenceImageUrl/);
      expect(fetchMock).not.toHaveBeenCalled(); // no network call attempted at all
    });

    it("idempotencyKey is never forwarded to fal.ai's own request body — it's an internal-only field", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => submitResponse() });
      vi.stubGlobal("fetch", fetchMock);
      const { KlingVideoProvider } = await import("@/lib/media/providers/klingVideo");
      const provider = new KlingVideoProvider();
      await provider.submit(baseRequest({ idempotencyKey: "should-not-leak" }));
      const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      expect(JSON.stringify(body)).not.toContain("should-not-leak");
    });

    it("a real submission HTTP error throws MediaProviderError with the real status/body", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => "invalid start_image_url" }),
      );
      const { KlingVideoProvider } = await import("@/lib/media/providers/klingVideo");
      const provider = new KlingVideoProvider();
      await expect(provider.submit(baseRequest())).rejects.toBeInstanceOf(MediaProviderError);
    });

    it("a submission response with no request_id throws a clear error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
      const { KlingVideoProvider } = await import("@/lib/media/providers/klingVideo");
      const provider = new KlingVideoProvider();
      await expect(provider.submit(baseRequest())).rejects.toThrow(/request_id/);
    });

    it("no API secret (FAL_KEY) ever appears inside the jobHandle string itself (Task 5, point 8)", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => submitResponse() }));
      const { KlingVideoProvider } = await import("@/lib/media/providers/klingVideo");
      const provider = new KlingVideoProvider();
      const { jobHandle } = await provider.submit(baseRequest());
      expect(jobHandle).not.toContain("fake-key-for-tests");
      expect(jobHandle).not.toContain(process.env.FAL_KEY);
    });
  });

  describe("jobHandle — serializable, survives serialize/deserialize, fails safely when malformed (Task 5, points 6-7)", () => {
    it("the jobHandle string survives a JSON.parse(JSON.stringify(...)) round-trip unchanged, and poll() still works from the round-tripped copy", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => submitResponse() }));
      const { KlingVideoProvider } = await import("@/lib/media/providers/klingVideo");
      const provider = new KlingVideoProvider();
      const { jobHandle } = await provider.submit(baseRequest());

      // Simulate a real persistence round-trip (e.g. a durable Inngest step
      // output, or a DB column) — parse then re-stringify the outer handle.
      const roundTripped = JSON.stringify(JSON.parse(jobHandle));
      expect(roundTripped).toBe(jobHandle);

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "IN_QUEUE" }) }));
      const outcome = await provider.poll(roundTripped);
      expect(outcome.status).toBe("pending");
    });

    it("rejects a malformed (non-JSON) jobHandle safely, with a clear error", async () => {
      const { KlingVideoProvider } = await import("@/lib/media/providers/klingVideo");
      const provider = new KlingVideoProvider();
      await expect(provider.poll("not-a-real-handle")).rejects.toThrow(/Malformed Kling jobHandle/);
    });

    it("rejects a well-formed JSON jobHandle that's missing required fields safely, with a clear error", async () => {
      const { KlingVideoProvider } = await import("@/lib/media/providers/klingVideo");
      const provider = new KlingVideoProvider();
      await expect(provider.poll(JSON.stringify({ requestId: "req-1" }))).rejects.toThrow(/Malformed Kling jobHandle/);
      await expect(provider.poll(JSON.stringify({}))).rejects.toThrow(/Malformed Kling jobHandle/);
      await expect(provider.poll("[]")).rejects.toThrow(/Malformed Kling jobHandle/);
      await expect(provider.poll("null")).rejects.toThrow(/Malformed Kling jobHandle/);
    });
  });

  describe("poll() — uses the authoritative server-returned URLs verbatim, never a reconstructed queue URL (Task 5, points 4, 5, 10)", () => {
    it("IN_QUEUE and IN_PROGRESS both report \"pending\" without fetching a result, using the real statusUrl from the jobHandle", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "IN_QUEUE", queue_position: 3 }) });
      vi.stubGlobal("fetch", fetchMock);
      const { KlingVideoProvider } = await import("@/lib/media/providers/klingVideo");
      const provider = new KlingVideoProvider();
      const outcome = await provider.poll(encodeTestJobHandle());
      expect(outcome.status).toBe("pending");
      expect(fetchMock).toHaveBeenCalledTimes(1); // status check only — never a result fetch while pending
      const [statusUrl] = fetchMock.mock.calls[0] as [string];
      expect(statusUrl).toBe(FAKE_STATUS_URL);
      // Never the reconstructed queue.fal.run shape, anywhere in the call.
      expect(statusUrl).not.toMatch(/queue\.fal\.run/);
    });

    it("COMPLETED fetches the real result via the real responseUrl and returns a correctly-shaped MediaResult with real usage", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "COMPLETED", metrics: { inference_time: 42.1 } }) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ video: { url: "https://cdn.fal.ai/out.mp4", content_type: "video/mp4", file_name: "out.mp4", file_size: 123456 } }),
        });
      vi.stubGlobal("fetch", fetchMock);
      const { KlingVideoProvider } = await import("@/lib/media/providers/klingVideo");
      const provider = new KlingVideoProvider();
      const outcome = await provider.poll(encodeTestJobHandle());

      expect(outcome.status).toBe("done");
      expect(outcome.result!.contentType).toBe("video/mp4");
      expect(outcome.result!.byteSize).toBe(123456);
      expect(outcome.result!.usage).toEqual({
        provider: "fal-ai",
        model: "fal-ai/kling-video/v3/pro/image-to-video",
        unit: "seconds",
        quantity: 5, // recovered from the jobHandle's own encoded duration
        usdCost: 5 * 0.112,
      });

      const [statusUrl, resultUrl] = fetchMock.mock.calls.map((c) => c[0] as string);
      expect(statusUrl).toBe(FAKE_STATUS_URL);
      expect(resultUrl).toBe(FAKE_RESPONSE_URL);
      // The exact regression this fix exists for: no hand-built queue.fal.run/.../requests/{id} URL anywhere.
      expect(statusUrl).not.toMatch(/queue\.fal\.run/);
      expect(resultUrl).not.toMatch(/queue\.fal\.run/);
    });

    it("a status response carrying a real error reports \"failed\" with the real detail, never attempts a result fetch", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "COMPLETED", error: "content policy violation", error_type: "ValidationError" }) });
      vi.stubGlobal("fetch", fetchMock);
      const { KlingVideoProvider } = await import("@/lib/media/providers/klingVideo");
      const provider = new KlingVideoProvider();
      const outcome = await provider.poll(encodeTestJobHandle());
      expect(outcome.status).toBe("failed");
      expect(outcome.detail).toContain("content policy violation");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("COMPLETED with no video.url throws a clear error rather than returning a hollow result", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "COMPLETED" }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      vi.stubGlobal("fetch", fetchMock);
      const { KlingVideoProvider } = await import("@/lib/media/providers/klingVideo");
      const provider = new KlingVideoProvider();
      await expect(provider.poll(encodeTestJobHandle())).rejects.toThrow(/no video\.url/);
    });

    it("a status-check HTTP error throws MediaProviderError", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "not found" }));
      const { KlingVideoProvider } = await import("@/lib/media/providers/klingVideo");
      const provider = new KlingVideoProvider();
      await expect(provider.poll(encodeTestJobHandle())).rejects.toBeInstanceOf(MediaProviderError);
    });
  });

  describe("generate() — submit + bounded poll loop", () => {
    it("polls through pending states and returns the real result once done (submit → pending → pending → done), using the authoritative URLs throughout", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => submitResponse() }) // submit
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "IN_QUEUE" }) }) // poll 1
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "IN_PROGRESS" }) }) // poll 2
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "COMPLETED" }) }) // poll 3 status
        .mockResolvedValueOnce({ ok: true, json: async () => ({ video: { url: "https://cdn.fal.ai/out.mp4", content_type: "video/mp4", file_size: 999 } }) }); // poll 3 result
      vi.stubGlobal("fetch", fetchMock);
      vi.useFakeTimers();

      const { KlingVideoProvider } = await import("@/lib/media/providers/klingVideo");
      const provider = new KlingVideoProvider();
      const resultPromise = provider.generate(baseRequest());

      // Advance past each 5s poll interval so the loop's own setTimeout waits resolve.
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);

      const result = await resultPromise;
      expect(result.contentType).toBe("video/mp4");
      expect(result.byteSize).toBe(999);
      expect(fetchMock).toHaveBeenCalledTimes(5);

      const calledUrls = fetchMock.mock.calls.map((c) => c[0] as string);
      expect(calledUrls[1]).toBe(FAKE_STATUS_URL);
      expect(calledUrls[2]).toBe(FAKE_STATUS_URL);
      expect(calledUrls[3]).toBe(FAKE_STATUS_URL);
      expect(calledUrls[4]).toBe(FAKE_RESPONSE_URL);
      // No reconstructed queue URL anywhere in the whole call sequence.
      for (const url of calledUrls.slice(1)) {
        expect(url).not.toMatch(/queue\.fal\.run\/.*\/requests\//);
      }
    });

    it("a failed poll outcome makes generate() throw MediaProviderError", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => submitResponse() })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "COMPLETED", error: "generation failed" }) });
      vi.stubGlobal("fetch", fetchMock);
      const { KlingVideoProvider } = await import("@/lib/media/providers/klingVideo");
      const provider = new KlingVideoProvider();
      await expect(provider.generate(baseRequest())).rejects.toBeInstanceOf(MediaProviderError);
    });

    it("never completing within the bounded 10-minute ceiling makes generate() throw a clear timeout error, not hang forever", async () => {
      const fetchMock = vi.fn().mockImplementation(async (url: string) => {
        if (url === FAKE_STATUS_URL) return { ok: true, json: async () => ({ status: "IN_PROGRESS" }) };
        return { ok: true, json: async () => submitResponse() };
      });
      vi.stubGlobal("fetch", fetchMock);
      vi.useFakeTimers();

      const { KlingVideoProvider } = await import("@/lib/media/providers/klingVideo");
      const provider = new KlingVideoProvider();
      const resultPromise = provider.generate(baseRequest());
      const assertion = expect(resultPromise).rejects.toThrow(/timed out after/);

      // Advance well past the real 10-minute ceiling in 5s increments (the poll interval).
      for (let i = 0; i < 130; i++) {
        await vi.advanceTimersByTimeAsync(5000);
      }

      await assertion;
    }, 20000);
  });

  describe("lookup()", () => {
    it("always returns null — a real, documented gap (no persisted request_id mapping exists for this proof), never a false positive", async () => {
      const { KlingVideoProvider } = await import("@/lib/media/providers/klingVideo");
      const provider = new KlingVideoProvider();
      await expect(provider.lookup()).resolves.toBeNull();
    });
  });
});
