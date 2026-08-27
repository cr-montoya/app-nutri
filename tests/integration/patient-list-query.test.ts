import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listPatients } from "@/server/services/patients";
import { adminDb } from "../helpers/admin-db";

/**
 * T4.1, closes REQ-015, REQ-016, REQ-017.
 */

const runId = Date.now();
let org: { id: string };
let user: { id: string };

beforeAll(async () => {
  org = await adminDb.organization.create({
    data: { name: `Patient List Query Org ${runId}`, slug: `patient-list-query-org-${runId}` },
  });
  user = await adminDb.user.create({
    data: { email: `patient-list-query-${runId}@example.test`, passwordHash: "x", name: "Actor" },
  });
  await adminDb.membership.create({ data: { userId: user.id, organizationId: org.id, role: "ADMIN" } });

  await adminDb.patient.createMany({
    data: [
      { organizationId: org.id, fullName: "Alice Anderson", phone: "+15550000001", documentId: "DOC-ALICE" },
      { organizationId: org.id, fullName: "Bob Brown", phone: "+15550000002", documentId: "DOC-BOB" },
      {
        organizationId: org.id,
        fullName: "Carol Archived",
        phone: "+15550000003",
        documentId: "DOC-CAROL",
        archivedAt: new Date(),
      },
    ],
  });
});

afterAll(async () => {
  await adminDb.patient.deleteMany({ where: { organizationId: org.id } });
  await adminDb.membership.deleteMany({ where: { organizationId: org.id } });
  await adminDb.user.deleteMany({ where: { id: user.id } });
  await adminDb.organization.deleteMany({ where: { id: org.id } });
  await adminDb.$disconnect();
});

describe("listPatients (REQ-015)", () => {
  it("excludes archived patients by default", async () => {
    const patients = await listPatients({ organizationId: org.id, userId: user.id });
    expect(patients.map((p) => p.fullName).sort()).toEqual(["Alice Anderson", "Bob Brown"]);
  });
});

describe("listPatients (REQ-016)", () => {
  it("includes archived patients when includeArchived is true", async () => {
    const patients = await listPatients({ organizationId: org.id, userId: user.id, includeArchived: true });
    expect(patients).toHaveLength(3);
    const carol = patients.find((p) => p.fullName === "Carol Archived");
    expect(carol?.archivedAt).not.toBeNull();
  });
});

describe("listPatients (REQ-017)", () => {
  it("matches a partial, case-insensitive name query", async () => {
    const patients = await listPatients({ organizationId: org.id, userId: user.id, query: "ali" });
    expect(patients.map((p) => p.fullName)).toEqual(["Alice Anderson"]);
  });

  it("matches an exact documentId", async () => {
    const patients = await listPatients({ organizationId: org.id, userId: user.id, query: "DOC-BOB" });
    expect(patients.map((p) => p.fullName)).toEqual(["Bob Brown"]);
  });

  it("respects the archived filter combined with a search query", async () => {
    const excluded = await listPatients({ organizationId: org.id, userId: user.id, query: "Carol" });
    expect(excluded).toHaveLength(0);

    const included = await listPatients({
      organizationId: org.id,
      userId: user.id,
      query: "Carol",
      includeArchived: true,
    });
    expect(included.map((p) => p.fullName)).toEqual(["Carol Archived"]);
  });

  it("returns every non-archived patient for an empty query", async () => {
    const patients = await listPatients({ organizationId: org.id, userId: user.id, query: "   " });
    expect(patients).toHaveLength(2);
  });
});
