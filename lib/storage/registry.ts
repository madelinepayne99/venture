import "server-only";
import type { StorageProvider } from "./types";
import { LocalDiskStorageProvider } from "./localDisk";

// Env-key-selected, same pattern as lib/media/registry.ts. C1 only wires
// up local disk (dev/test); a real deployment adds a VercelBlobStorage
// implementation behind this same interface with no other architecture
// change (see CLAUDE.md's Content Bot milestone, §0b) — not built yet
// because C1 doesn't need a real deployment to be implemented or
// live-tested.

let storageProvider: StorageProvider | undefined;

export function getStorageProvider(): StorageProvider {
  if (storageProvider) return storageProvider;
  const key = process.env.CONTENT_STORAGE_PROVIDER || "local_disk";
  if (key === "local_disk") {
    storageProvider = new LocalDiskStorageProvider();
    return storageProvider;
  }
  throw new Error(`Unknown CONTENT_STORAGE_PROVIDER "${key}" — no storage provider registered for it.`);
}
