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
 */
export async function getContentItemDetail(contentItemId: string) {
  const item = await getContentItem(contentItemId);
  if (!item) return null;

  const [mission, versions, stages, approvals, costs, spentUsd] = await Promise.all([
    getMission(item.mission_id),
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
