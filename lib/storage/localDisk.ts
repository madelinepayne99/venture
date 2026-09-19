import "server-only";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { StorageProvider, StoredObject } from "./types";

interface StoredMeta {
  contentType: string;
  byteSize: number;
  checksumSha256: string;
}

/**
 * Real files on a real disk — dev/test ONLY (see CLAUDE.md's Content Bot
 * milestone, §0b: Vercel's serverless filesystem is read-only outside
 * /tmp, and /tmp itself doesn't persist across invocations, so this
 * implementation is never used in a real deployment; VercelBlobStorage
 * fills that role once one exists). Keyed under CONTENT_STORAGE_DIR
 * (gitignored). A sidecar `<key>.meta.json` file carries content type and
 * the real, measured byte size/checksum, since a plain filesystem has no
 * built-in object metadata store.
 */
export class LocalDiskStorageProvider implements StorageProvider {
  readonly key = "local_disk";

  private rootDir(): string {
    const dir = process.env.CONTENT_STORAGE_DIR;
    if (!dir) {
      throw new Error("CONTENT_STORAGE_DIR is not set — see .env.example.");
    }
    return path.resolve(dir);
  }

  private resolvePath(key: string): string {
    const root = this.rootDir();
    const full = path.resolve(root, key);
    if (full !== root && !full.startsWith(root + path.sep)) {
      throw new Error(`Invalid storage key (would escape the storage root): ${key}`);
    }
    return full;
  }

  private metaPath(fullPath: string): string {
    return `${fullPath}.meta.json`;
  }

  async put(key: string, body: ReadableStream<Uint8Array>, contentType: string): Promise<StoredObject> {
    const fullPath = this.resolvePath(key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    const hash = createHash("sha256");
    let byteSize = 0;
    const chunks: Buffer[] = [];
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const buf = Buffer.from(value);
      byteSize += buf.byteLength;
      hash.update(buf);
      chunks.push(buf);
    }
    await fs.writeFile(fullPath, Buffer.concat(chunks));

    const meta: StoredMeta = { contentType, byteSize, checksumSha256: hash.digest("hex") };
    await fs.writeFile(this.metaPath(fullPath), JSON.stringify(meta));

    return { storageProvider: this.key, storageKey: key, contentType, byteSize, checksumSha256: meta.checksumSha256 };
  }

  async open(
    key: string,
    range?: { start: number; end?: number },
  ): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string; byteSize: number; contentRange?: string }> {
    const fullPath = this.resolvePath(key);
    const meta = await this.readMeta(fullPath);
    const stat = await fs.stat(fullPath);
    const byteSize = meta?.byteSize ?? stat.size;
    const contentType = meta?.contentType ?? "application/octet-stream";

    if (range) {
      const start = range.start;
      const end = range.end ?? byteSize - 1;
      const nodeStream = createReadStream(fullPath, { start, end });
      return {
        stream: Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>,
        contentType,
        // The SLICE's length, not the whole file's — this is what a 206
        // response's Content-Length must report (the full size still
        // appears in contentRange's "/total" suffix below). Getting this
        // wrong breaks range requests silently: the client requests N
        // bytes, the server claims to send the full file's byte count,
        // and playback/seeking in the review player would corrupt.
        byteSize: end - start + 1,
        contentRange: `bytes ${start}-${end}/${byteSize}`,
      };
    }

    const nodeStream = createReadStream(fullPath);
    return {
      stream: Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>,
      contentType,
      byteSize,
    };
  }

  async head(key: string): Promise<StoredObject | null> {
    const fullPath = this.resolvePath(key);
    try {
      const meta = await this.readMeta(fullPath);
      if (!meta) return null;
      return { storageProvider: this.key, storageKey: key, ...meta };
    } catch {
      return null;
    }
  }

  async signedReadUrl(): Promise<string | null> {
    // Local disk has no public URL of its own — callers fall back to the
    // authenticated /api/content/assets/[assetId]/stream route, or (for a
    // provider that needs to fetch this asset itself, e.g. Shotstack) a
    // staged public copy — see runContentProductionPipeline.
    return null;
  }

  private async readMeta(fullPath: string): Promise<StoredMeta | null> {
    try {
      const raw = await fs.readFile(this.metaPath(fullPath), "utf-8");
      return JSON.parse(raw) as StoredMeta;
    } catch {
      return null;
    }
  }
}
