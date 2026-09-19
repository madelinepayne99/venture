"use client";

import type { ContentAsset } from "@/lib/db/types";

const KIND_LABELS: Record<string, string> = {
  video: "Video",
  audio: "Voiceover",
  thumbnail: "Thumbnail",
  caption_track: "Captions",
  image: "Still",
  script: "Script",
};

export function ContentAssetList({ assets }: { assets: ContentAsset[] }) {
  if (assets.length === 0) {
    return <p className="text-xs text-hq-slate">No assets generated yet for this version.</p>;
  }

  return (
    <ul className="space-y-1 text-xs">
      {assets.map((a) => (
        <li key={a.id} className="flex items-center justify-between rounded bg-white/50 px-2 py-1">
          <span>
            {KIND_LABELS[a.kind] ?? a.kind}
            {a.duration_seconds != null && ` — ${a.duration_seconds.toFixed(1)}s`}
            {a.width && a.height ? ` — ${a.width}×${a.height}` : ""}
          </span>
          <a
            href={`/api/content/assets/${a.id}/stream`}
            target="_blank"
            rel="noreferrer"
            className="text-hq-teal underline"
          >
            open
          </a>
        </li>
      ))}
    </ul>
  );
}
