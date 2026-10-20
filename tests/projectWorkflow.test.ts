import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "@/lib/db/client";
import { listProjects, listFounders } from "@/lib/db/repositories";
import { validateProjectInput } from "@/lib/domain/projectValidation";
import { createWorkspace, ProjectValidationError } from "@/lib/domain/projectWorkflow";
import { getActiveOrganizationForFounder } from "@/lib/domain/organizationWorkflow";

describe("validateProjectInput", () => {
  it("rejects an empty name", () => {
    const result = validateProjectInput({ name: "", workspaceType: "commerce" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("name"))).toBe(true);
  });

  it("rejects a missing or unrecognized workspace type", () => {
    expect(validateProjectInput({ name: "Test", workspaceType: "" }).valid).toBe(false);
    expect(validateProjectInput({ name: "Test", workspaceType: "not-a-real-type" }).valid).toBe(false);
  });

  it("accepts a valid commerce or service_business input", () => {
    expect(validateProjectInput({ name: "Digital Products 2", workspaceType: "commerce" }).valid).toBe(true);
    expect(
      validateProjectInput({ name: "Hair & Beauty", workspaceType: "service_business" }).valid,
    ).toBe(true);
  });
});

async function seededFounderId(): Promise<string> {
  const founders = await listFounders();
  return founders[0]!.id;
}

describe("createWorkspace", () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it("creates a new workspace with the requested type", async () => {
    const founderId = await seededFounderId();
    const organization = await getActiveOrganizationForFounder(founderId);
    const project = await createWorkspace(founderId, { name: "Hair & Beauty Clients", workspaceType: "service_business" });

    expect(project.name).toBe("Hair & Beauty Clients");
    expect(project.workspace_type).toBe("service_business");

    const projects = await listProjects(organization.id);
    expect(projects.some((p) => p.id === project.id)).toBe(true);
  });

  it("throws before writing anything when the input is invalid", async () => {
    const founderId = await seededFounderId();
    const organization = await getActiveOrganizationForFounder(founderId);
    const before = await listProjects(organization.id);

    await expect(createWorkspace(founderId, { name: "", workspaceType: "commerce" })).rejects.toBeInstanceOf(
      ProjectValidationError,
    );
    await expect(
      createWorkspace(founderId, { name: "Valid name", workspaceType: "not-a-real-type" }),
    ).rejects.toBeInstanceOf(ProjectValidationError);

    const after = await listProjects(organization.id);
    expect(after).toHaveLength(before.length);
  });

  it("never repurposes the existing seeded Commerce workspace when a new one is created", async () => {
    const founderId = await seededFounderId();
    const organization = await getActiveOrganizationForFounder(founderId);
    const seeded = (await listProjects(organization.id)).find((p) => p.name === "Digital Products")!;
    expect(seeded.workspace_type).toBe("commerce");

    await createWorkspace(founderId, { name: "Hair & Beauty Clients", workspaceType: "service_business" });

    const stillSeeded = (await listProjects(organization.id)).find((p) => p.id === seeded.id)!;
    expect(stillSeeded.workspace_type).toBe("commerce");
  });
});
