import "server-only";
import {
  createChecklist,
  listChecklistsForFounder,
  getChecklist,
  getChecklistWithItems,
  addChecklistItem,
  setChecklistItemDone,
} from "@/lib/db/repositories";
import type { Checklist, ChecklistWithItems } from "@/lib/db/types";
import { getActiveOrganizationForFounder } from "@/lib/domain/organizationWorkflow";

/**
 * Operations Agent's one real, tested capability: checklists (acceptance
 * Test D from the Operations Expansion brief — "Create a launch checklist
 * for our first YouTube channel" — persistent, inspectable, updatable).
 * No document templates or external process integration yet; see
 * docs/operations-build-progress.md for what's explicitly not built.
 */

export class ChecklistValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join(" "));
    this.name = "ChecklistValidationError";
  }
}

export class ChecklistNotFoundError extends Error {
  constructor(id: string) {
    super(`Checklist ${id} not found.`);
    this.name = "ChecklistNotFoundError";
  }
}

export class ChecklistItemNotFoundError extends Error {
  constructor(id: string) {
    super(`Checklist item ${id} not found.`);
    this.name = "ChecklistItemNotFoundError";
  }
}

export interface CreateChecklistInput {
  title?: string;
  items?: string[];
}

function validateCreateChecklistInput(input: CreateChecklistInput): string[] {
  const errors: string[] = [];
  const title = input.title?.trim();
  if (!title) errors.push("A checklist needs a non-empty title.");
  if (title && title.length > 500) errors.push("Checklist title must be 500 characters or fewer.");
  const items = input.items ?? [];
  if (items.length > 100) errors.push("A checklist may have at most 100 items.");
  for (const item of items) {
    if (!item?.trim()) errors.push("Checklist items must be non-empty.");
  }
  return errors;
}

export async function createFounderChecklist(
  founderId: string,
  input: CreateChecklistInput,
): Promise<ChecklistWithItems> {
  const errors = validateCreateChecklistInput(input);
  if (errors.length) throw new ChecklistValidationError(errors);

  const organization = await getActiveOrganizationForFounder(founderId);
  return createChecklist({
    founderId,
    organizationId: organization.id,
    title: input.title!.trim(),
    itemLabels: (input.items ?? []).map((item) => item.trim()).filter(Boolean),
  });
}

export async function listFounderChecklists(founderId: string): Promise<Checklist[]> {
  return listChecklistsForFounder(founderId);
}

async function requireOwnedChecklist(id: string, founderId: string): Promise<Checklist> {
  const checklist = await getChecklist(id);
  if (!checklist || checklist.founder_id !== founderId) {
    throw new ChecklistNotFoundError(id);
  }
  return checklist;
}

export async function getFounderChecklist(id: string, founderId: string): Promise<ChecklistWithItems> {
  await requireOwnedChecklist(id, founderId);
  const withItems = await getChecklistWithItems(id);
  if (!withItems) throw new ChecklistNotFoundError(id);
  return withItems;
}

export async function addItemToChecklist(
  checklistId: string,
  founderId: string,
  label: string,
): Promise<ChecklistWithItems> {
  await requireOwnedChecklist(checklistId, founderId);
  const trimmed = label?.trim();
  if (!trimmed) throw new ChecklistValidationError(["A checklist item needs non-empty text."]);
  if (trimmed.length > 500) throw new ChecklistValidationError(["Checklist item text must be 500 characters or fewer."]);

  await addChecklistItem(checklistId, trimmed);
  const withItems = await getChecklistWithItems(checklistId);
  if (!withItems) throw new ChecklistNotFoundError(checklistId);
  return withItems;
}

export async function setItemDone(
  checklistId: string,
  itemId: string,
  founderId: string,
  isDone: boolean,
): Promise<ChecklistWithItems> {
  const checklist = await requireOwnedChecklist(checklistId, founderId);
  const withItems = await getChecklistWithItems(checklist.id);
  if (!withItems) throw new ChecklistNotFoundError(checklistId);
  const item = withItems.items.find((i) => i.id === itemId);
  if (!item) throw new ChecklistItemNotFoundError(itemId);

  await setChecklistItemDone(itemId, isDone);
  const updated = await getChecklistWithItems(checklistId);
  if (!updated) throw new ChecklistNotFoundError(checklistId);
  return updated;
}
