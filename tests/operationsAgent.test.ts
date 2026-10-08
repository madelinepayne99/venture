import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import { listFounders, getAgentByKey } from "@/lib/db/repositories";
import {
  createFounderChecklist,
  listFounderChecklists,
  getFounderChecklist,
  addItemToChecklist,
  setItemDone,
  ChecklistValidationError,
  ChecklistNotFoundError,
  ChecklistItemNotFoundError,
} from "@/lib/domain/operationsWorkflow";

async function seededFounderId(): Promise<string> {
  const founders = await listFounders();
  return founders[0]!.id;
}

describe("Operations Agent is registered correctly", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("seeds operations_agent as active", async () => {
    const agent = await getAgentByKey("operations_agent");
    expect(agent?.status).toBe("active");
  });
});

describe("createFounderChecklist — the launch-checklist acceptance test", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("creates a real, persisted checklist with ordered items owned by the calling founder", async () => {
    const founderId = await seededFounderId();
    const checklist = await createFounderChecklist(founderId, {
      title: "Launch checklist — YouTube channel",
      items: ["Create channel art", "Write channel description", "Publish trailer"],
    });

    expect(checklist.title).toBe("Launch checklist — YouTube channel");
    expect(checklist.founder_id).toBe(founderId);
    expect(checklist.items).toHaveLength(3);
    expect(checklist.items.map((i) => i.label)).toEqual([
      "Create channel art",
      "Write channel description",
      "Publish trailer",
    ]);
    expect(checklist.items.every((i) => i.is_done === false)).toBe(true);
  });

  it("is genuinely visible after a fresh read — not just returned from the write", async () => {
    const founderId = await seededFounderId();
    const created = await createFounderChecklist(founderId, {
      title: "Real persistence check",
      items: ["One item"],
    });

    const reread = await getFounderChecklist(created.id, founderId);
    expect(reread.title).toBe("Real persistence check");
    expect(reread.items).toHaveLength(1);
  });

  it("allows a checklist with no items yet", async () => {
    const founderId = await seededFounderId();
    const checklist = await createFounderChecklist(founderId, { title: "Empty for now" });
    expect(checklist.items).toHaveLength(0);
  });

  it("rejects an empty title and writes nothing", async () => {
    const founderId = await seededFounderId();
    const before = await listFounderChecklists(founderId);

    await expect(createFounderChecklist(founderId, { title: "" })).rejects.toBeInstanceOf(
      ChecklistValidationError,
    );
    await expect(createFounderChecklist(founderId, { title: "   " })).rejects.toBeInstanceOf(
      ChecklistValidationError,
    );

    const after = await listFounderChecklists(founderId);
    expect(after).toHaveLength(before.length);
  });

  it("rejects a blank item and writes nothing", async () => {
    const founderId = await seededFounderId();
    const before = await listFounderChecklists(founderId);

    await expect(
      createFounderChecklist(founderId, { title: "Valid title", items: ["Real item", "   "] }),
    ).rejects.toBeInstanceOf(ChecklistValidationError);

    const after = await listFounderChecklists(founderId);
    expect(after).toHaveLength(before.length);
  });
});

describe("listFounderChecklists / getFounderChecklist — ownership isolation", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("only returns the calling founder's own checklists", async () => {
    const founderId = await seededFounderId();
    await createFounderChecklist(founderId, { title: "Mine" });

    const checklists = await listFounderChecklists(founderId);
    expect(checklists.every((c) => c.founder_id === founderId)).toBe(true);
  });

  it("refuses to read a checklist owned by a different founder", async () => {
    const founders = await listFounders();
    const owner = founders[0]!.id;
    const checklist = await createFounderChecklist(owner, { title: "Not yours" });

    const otherFounder = founders.find((f) => f.id !== owner);
    if (!otherFounder) {
      // This app's seed data ships two founder rows (CLAUDE.md's
      // Authentication section) — if that ever changes, this isolation
      // check still needs a second founder to mean anything.
      return;
    }
    await expect(getFounderChecklist(checklist.id, otherFounder.id)).rejects.toBeInstanceOf(
      ChecklistNotFoundError,
    );
  });

  it("throws ChecklistNotFoundError for a nonexistent id", async () => {
    const founderId = await seededFounderId();
    await expect(getFounderChecklist("does-not-exist", founderId)).rejects.toBeInstanceOf(
      ChecklistNotFoundError,
    );
  });
});

describe("addItemToChecklist / setItemDone — the updatable half of the acceptance test", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("adds a new item to an existing checklist, appended after existing items", async () => {
    const founderId = await seededFounderId();
    const checklist = await createFounderChecklist(founderId, {
      title: "Growing list",
      items: ["First"],
    });

    const updated = await addItemToChecklist(checklist.id, founderId, "Second");
    expect(updated.items.map((i) => i.label)).toEqual(["First", "Second"]);
  });

  it("rejects a blank item label and writes nothing", async () => {
    const founderId = await seededFounderId();
    const checklist = await createFounderChecklist(founderId, { title: "List", items: ["First"] });

    await expect(addItemToChecklist(checklist.id, founderId, "   ")).rejects.toBeInstanceOf(
      ChecklistValidationError,
    );

    const reread = await getFounderChecklist(checklist.id, founderId);
    expect(reread.items).toHaveLength(1);
  });

  it("marks an item done, and back to not-done, with the change genuinely persisted", async () => {
    const founderId = await seededFounderId();
    const checklist = await createFounderChecklist(founderId, {
      title: "Toggle test",
      items: ["Do the thing"],
    });
    const itemId = checklist.items[0]!.id;

    const afterDone = await setItemDone(checklist.id, itemId, founderId, true);
    expect(afterDone.items[0]!.is_done).toBe(true);

    const reread = await getFounderChecklist(checklist.id, founderId);
    expect(reread.items[0]!.is_done).toBe(true);

    const afterUndone = await setItemDone(checklist.id, itemId, founderId, false);
    expect(afterUndone.items[0]!.is_done).toBe(false);
  });

  it("throws ChecklistItemNotFoundError for an item that doesn't belong to the checklist", async () => {
    const founderId = await seededFounderId();
    const checklist = await createFounderChecklist(founderId, { title: "List", items: ["Item"] });

    await expect(setItemDone(checklist.id, "not-a-real-item", founderId, true)).rejects.toBeInstanceOf(
      ChecklistItemNotFoundError,
    );
  });

  it("refuses to mutate a checklist owned by a different founder", async () => {
    const founders = await listFounders();
    const owner = founders[0]!.id;
    const checklist = await createFounderChecklist(owner, { title: "Not yours", items: ["Item"] });

    const otherFounder = founders.find((f) => f.id !== owner);
    if (!otherFounder) return;

    await expect(addItemToChecklist(checklist.id, otherFounder.id, "Sneaky item")).rejects.toBeInstanceOf(
      ChecklistNotFoundError,
    );
  });
});
