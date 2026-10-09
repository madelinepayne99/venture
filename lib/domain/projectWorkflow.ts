import "server-only";
import { createProject } from "@/lib/db/repositories";
import { validateProjectInput, type ProjectInput } from "@/lib/domain/projectValidation";
import type { Project, WorkspaceType } from "@/lib/db/types";
import { getActiveOrganizationForFounder } from "@/lib/domain/organizationWorkflow";

export class ProjectValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join(" "));
    this.name = "ProjectValidationError";
  }
}

/**
 * Creates a new project/workspace. This is the only write path for a
 * workspace's type — there is no update function anywhere in this app, so
 * an existing workspace (and any missions already run under it) can never
 * be silently repurposed. A founder who wants a different kind of
 * workspace creates a new one, explicitly, with its type set once, here.
 */
export async function createWorkspace(founderId: string, input: Partial<ProjectInput>): Promise<Project> {
  const validation = validateProjectInput(input);
  if (!validation.valid) {
    throw new ProjectValidationError(validation.errors);
  }

  const organization = await getActiveOrganizationForFounder(founderId);
  return createProject({
    name: input.name!.trim(),
    organizationId: organization.id,
    workspaceType: input.workspaceType as WorkspaceType,
  });
}
