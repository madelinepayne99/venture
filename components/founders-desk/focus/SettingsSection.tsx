import type { Project, WorkspaceType } from "@/lib/db/types";
import { WorkspacePanel } from "../WorkspacePanel";
import { FocusCard } from "./FocusPrimitives";
import { BillingSection } from "./BillingSection";
import { AccountSection } from "./AccountSection";

/**
 * Settings (Mission 8 Focus View redesign) — workspace management, plus
 * real plan & billing status (Mission 8, Sections 14-15 — this is
 * exactly the "natural future home for plan/billing" this section's own
 * earlier doc comment anticipated). Reuses the exact same real
 * `createWorkspace` workflow (Milestone 3) FocusView always used — a
 * workspace's type still can never be changed after creation, same as
 * before. No extra heading on the workspace card — WorkspacePanel
 * already renders its own real one.
 */
export function SettingsSection({
  projects,
  onCreateWorkspace,
}: {
  projects: Project[];
  onCreateWorkspace: (name: string, workspaceType: WorkspaceType) => Promise<void>;
}) {
  return (
    <div className="space-y-6">
      <BillingSection />
      <FocusCard>
        <WorkspacePanel projects={projects} onCreate={onCreateWorkspace} />
      </FocusCard>
      <AccountSection />
    </div>
  );
}
