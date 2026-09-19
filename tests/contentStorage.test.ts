import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalDiskStorageProvider } from "@/lib/storage/localDisk";

function textStream(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

describe("LocalDiskStorageProvider (real filesystem)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "venture-content-storage-test-"));
    process.env.CONTENT_STORAGE_DIR = dir;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CONTENT_STORAGE_DIR;
  });

  it("round-trips real bytes with a measured byte size and checksum, never a provider's claim", async () => {
    const storage = new LocalDiskStorageProvider();
    const text = "the quick brown fox jumps over the lazy dog";
    const expectedChecksum = createHash("sha256").update(text).digest("hex");

    const stored = await storage.put("content/item-1/version-1/script.txt", textStream(text), "text/plain");

    expect(stored.byteSize).toBe(Buffer.byteLength(text));
    expect(stored.checksumSha256).toBe(expectedChecksum);

    const opened = await storage.open("content/item-1/version-1/script.txt");
    expect((await readAll(opened.stream)).toString("utf-8")).toBe(text);
    expect(opened.byteSize).toBe(Buffer.byteLength(text));

    const head = await storage.head("content/item-1/version-1/script.txt");
    expect(head).toEqual(stored);
  });

  it("returns null from head() for a key that was never written", async () => {
    const storage = new LocalDiskStorageProvider();
    expect(await storage.head("content/never/written.txt")).toBeNull();
  });

  it("serves a real byte range with the SLICE's length, not the whole file's", async () => {
    const storage = new LocalDiskStorageProvider();
    const text = "0123456789"; // 10 bytes
    await storage.put("content/range-test.txt", textStream(text), "text/plain");

    const ranged = await storage.open("content/range-test.txt", { start: 2, end: 5 });
    expect(ranged.contentRange).toBe("bytes 2-5/10");
    // 4 bytes (2,3,4,5), not the full file's 10.
    expect(ranged.byteSize).toBe(4);
    expect((await readAll(ranged.stream)).toString("utf-8")).toBe("2345");
  });

  it("serves an open-ended range (no explicit end) through to the real end of the file", async () => {
    const storage = new LocalDiskStorageProvider();
    const text = "0123456789";
    await storage.put("content/range-open.txt", textStream(text), "text/plain");

    const ranged = await storage.open("content/range-open.txt", { start: 7 });
    expect(ranged.contentRange).toBe("bytes 7-9/10");
    expect(ranged.byteSize).toBe(3);
    expect((await readAll(ranged.stream)).toString("utf-8")).toBe("789");
  });

  it("rejects a storage key that would escape the storage root", async () => {
    const storage = new LocalDiskStorageProvider();
    await expect(storage.put("../../etc/passwd", textStream("x"), "text/plain")).rejects.toThrow();
  });

  it("throws when CONTENT_STORAGE_DIR is not configured", async () => {
    delete process.env.CONTENT_STORAGE_DIR;
    const storage = new LocalDiskStorageProvider();
    await expect(storage.put("content/x.txt", textStream("x"), "text/plain")).rejects.toThrow();
  });

  it("always returns null from signedReadUrl — local disk has no public URL of its own", async () => {
    const storage = new LocalDiskStorageProvider();
    await storage.put("content/x.txt", textStream("x"), "text/plain");
    expect(await storage.signedReadUrl()).toBeNull();
  });
});
