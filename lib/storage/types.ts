export type StoredObject = {
  storageProvider: string;
  storageKey: string;
  contentType: string;
  /** Measured from real written bytes, never a provider's claim. */
  byteSize: number;
  checksumSha256: string;
};

export interface StorageProvider {
  readonly key: string; // "local_disk" | "vercel_blob"
  put(key: string, body: ReadableStream<Uint8Array>, contentType: string): Promise<StoredObject>;
  /** Range-aware, so the in-app review player can seek without downloading the whole file. */
  open(
    key: string,
    range?: { start: number; end?: number },
  ): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string; byteSize: number; contentRange?: string }>;
  head(key: string): Promise<StoredObject | null>;
  /** Null where the provider doesn't support it (e.g. local disk) — the caller falls back to the authenticated stream route. */
  signedReadUrl(key: string, ttlSeconds: number): Promise<string | null>;
}

// No `delete` — the insert-only philosophy (deliverables, evidence,
// content_versions) extends to bytes: a version's assets stay retrievable
// forever, even after a later revision exists.
