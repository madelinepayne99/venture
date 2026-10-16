import "server-only";
import {
  getContentItem,
  getMission,
  listVersionsWithAssets,
  listStagesForContentItem,
  listApprovalsForContentItem,
  listCostsForContentItem,
  contentItemSpendUsd,
} from "@/lib/db/repositories";

/**
 * Everything the founder review UI needs for one content item — real
 * versions+assets, scoped stages, approvals, and per-item cost, mirroring
 * getMissionDetail.ts's parallel-fetch shape. Never fabricates a field: a
 * one-version item simply has one entry in `versions`, not a placeholder
 * for a second.
 *
 * `organizationId` is required and real-server-resolved by the caller —
 * a content item belonging to a different organization (via its real
 * owning mission) returns `null`, the same shape as one that genuinely
 * doesn't exist (Master Development Mission 6 — Content Bot's own routes
 * had the exact gap Phase E already closed for Founders' Desk).
 */
export async function getContentItemDetail(contentItemId: string, organizationId: string) {
  const item = await getContentItem(contentItemId);
  if (!item) return null;
  const mission = await getMission(item.mission_id);
  if (!mission || mission.organization_id !== organizationId) return null;

  const [versions, stages, approvals, costs, spentUsd] = await Promise.all([
    listVersionsWithAssets(contentItemId),
    listStagesForContentItem(contentItemId),
    listApprovalsForContentItem(contentItemId),
    listCostsForContentItem(contentItemId),
    contentItemSpendUsd(contentItemId),
  ]);

  return {
    item,
    mission: mission ?? null,
    versions,
    stages,
    approvals,
    costs,
    spentUsd,
  };
}
