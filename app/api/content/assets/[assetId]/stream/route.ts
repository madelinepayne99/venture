import { NextRequest, NextResponse } from "next/server";
import { getContentAsset } from "@/lib/db/repositories";
import { getStorageProvider } from "@/lib/storage/registry";
import { toApiErrorResponse } from "@/lib/api/errors";
import { requireFounderId } from "@/lib/api/session";

/**
 * Never a public URL — the actual mechanism behind "watchable in-app, no
 * download-to-judge" (see CLAUDE.md's Content Bot milestone, §8): behind
 * the same founder-session boundary as every other route, range-aware so
 * the review player can seek without downloading the whole file.
 */
function parseRangeHeader(header: string | null, byteSize: number): { start: number; end?: number } | undefined {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return undefined;
  const [, startRaw, endRaw] = match;
  if (!startRaw && !endRaw) return undefined;
  if (!startRaw) {
    // A suffix range ("bytes=-500") means "the last 500 bytes."
    const suffixLength = Number(endRaw);
    return { start: Math.max(0, byteSize - suffixLength) };
  }
  const start = Number(startRaw);
  const end = endRaw ? Number(endRaw) : undefined;
  return { start, end };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  try {
    await requireFounderId();
    const { assetId } = await params;
    const asset = await getContentAsset(assetId);
    if (!asset) {
      return NextResponse.json({ error: `Content asset ${assetId} not found.` }, { status: 404 });
    }

    const storage = getStorageProvider();
    const head = await storage.head(asset.storage_key);
    const totalSize = head?.byteSize ?? asset.byte_size ?? 0;
    const range = parseRangeHeader(request.headers.get("range"), totalSize);
    const opened = await storage.open(asset.storage_key, range);

    const headers = new Headers({
      "Content-Type": opened.contentType,
      "Accept-Ranges": "bytes",
      "Content-Length": String(opened.byteSize),
      "Cache-Control": "private, no-store",
    });
    if (opened.contentRange) {
      headers.set("Content-Range", opened.contentRange);
    }

    return new NextResponse(opened.stream as unknown as ReadableStream, {
      status: opened.contentRange ? 206 : 200,
      headers,
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
