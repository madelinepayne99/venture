import type { Project, WorkspaceType } from "@/lib/db/types";
import { WorkspacePanel } from "../WorkspacePanel";
import { FocusCard } from "./FocusPrimitives";

/**
 * Settings (Mission 8 Focus View redesign) — workspace management today;
 * the natural future home for plan/billing/allowance configuration once
 * those exist. Reuses the exact same real `createWorkspace` workflow
 * (Milestone 3) FocusView always used — a workspace's type still can
 * never be changed after creation, same as before. No extra heading —
 * WorkspacePanel already renders its own real one.
 */
export function SettingsSection({
  projects,
  onCreateWorkspace,
}: {
  projects: Project[];
  onCreateWorkspace: (name: string, workspaceType: WorkspaceType) => Promise<void>;
}) {
  return (
    <FocusCard>
      <WorkspacePanel projects={projects} onCreate={onCreateWorkspace} />
    </FocusCard>
  );
}
