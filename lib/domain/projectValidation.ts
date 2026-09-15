import { workspaceTypeValues } from "@/lib/db/schema";
import type { WorkspaceType } from "@/lib/db/types";

export interface ProjectInput {
  name: string;
  workspaceType: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const NAME_MAX = 140;

function isWorkspaceType(value: string): value is WorkspaceType {
  return (workspaceTypeValues as readonly string[]).includes(value);
}

export function validateProjectInput(input: Partial<ProjectInput>): ValidationResult {
  const errors: string[] = [];

  const name = input.name?.trim() ?? "";
  if (!name) {
    errors.push("A workspace needs a name.");
  } else if (name.length > NAME_MAX) {
    errors.push(`Name must be ${NAME_MAX} characters or fewer.`);
  }

  const workspaceType = input.workspaceType ?? "";
  if (!workspaceType || !isWorkspaceType(workspaceType)) {
    errors.push(`Workspace type must be one of: ${workspaceTypeValues.join(", ")}.`);
  }

  return { valid: errors.length === 0, errors };
}
