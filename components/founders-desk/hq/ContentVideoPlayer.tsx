"use client";

import type { ContentAsset } from "@/lib/db/types";

/**
 * A plain <video>, exactly as CLAUDE.md's Content Bot milestone specifies
 * — controls, playsInline, preload="metadata" — against the authenticated
 * range-streamed asset route, never a public URL. If this version has no
 * finished video yet, that's shown explicitly rather than rendering an
 * empty player that implies one exists.
 */
export function ContentVideoPlayer({ assets }: { assets: ContentAsset[] }) {
  const video = assets.find((a) => a.kind === "video");
  const thumbnail = assets.find((a) => a.kind === "thumbnail");
  const captions = assets.find((a) => a.kind === "caption_track");

  if (!video) {
    return (
      <div className="rounded-lg border border-hq-brass/20 bg-white/50 p-4 text-sm text-hq-slate">
        No finished video for this version yet — still in production.
      </div>
    );
  }

  return (
    <video
      key={video.id}
      controls
      playsInline
      preload="metadata"
      poster={thumbnail ? `/api/content/assets/${thumbnail.id}/stream` : undefined}
      className="w-full rounded-lg border border-hq-brass/20 bg-black"
    >
      <source src={`/api/content/assets/${video.id}/stream`} type={video.content_type} />
      {captions && <track kind="captions" src={`/api/content/assets/${captions.id}/stream`} default />}
    </video>
  );
}
