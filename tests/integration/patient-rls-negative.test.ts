import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { adminDb } from "../helpers/admin-db";

/**
 * Negative RLS test (T1.6, closes REQ-020): a raw `pg` client -- bypassing
 * Prisma and the `withTenant` extension entirely -- with
 * `app.current_org_id` set to org A must still get zero rows querying org
 * B's `patients`/`audit_logs` directly. Same pattern as
 * tests/integration/rls-negative.test.ts; this is what proves RLS itself
 * (not just the Prisma Client Extension) enforces isolation for these two
 * tables too.
 */

const runId = Date.now();

let orgA: { id: string };
let orgB: { id: string };
let patientA: { id: string };
let patientB: { id: string };
let auditLogA: { id: string };
let auditLogB: { id: string };

beforeAll(async () => {
  orgA = await adminDb.organization.create({
    data: { name: "Patient RLS Negative Org A", slug: `patient-rls-negative-org-a-${runId}` },
  });
  orgB = await adminDb.organization.create({
    data: { name: "Patient RLS Negative Org B", slug: `patient-rls-negative-org-b-${runId}` },
  });
  patientA = await adminDb.patient.create({
    data: { organizationId: orgA.id, fullName: "Org A Patient", phone: "+15551110000" },
  });
  patientB = await adminDb.patient.create({
    data: { organizationId: orgB.id, fullName: "Org B Patient", phone: "+15552220000" },
  });
  auditLogA = await adminDb.auditLog.create({
    data: {
      organizationId: orgA.id,
      action: "patient.create",
      entityType: "Patient",
      entityId: patientA.id,
    },
  });
  auditLogB = await adminDb.auditLog.create({
    data: {
      organizationId: orgB.id,
      action: "patient.create",
      entityType: "Patient",
      entityId: patientB.id,
    },
  });
});

afterAll(async () => {
  await adminDb.auditLog.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await adminDb.patient.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await adminDb.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await adminDb.$disconnect();
});

async function queryAsOrg(organizationId: string, sql: string, params: string[]) {
  // Raw `pg`, not Prisma: the non-superuser appnutri_app role, which is the
  // role RLS policies actually apply to.
  const client = new Client({ connectionString: process.env.APP_DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [organizationId]);
    const result = await client.query(sql, params);
    await client.query("COMMIT");
    return result.rows;
  } finally {
    await client.end();
  }
}

describe("Raw pg client: negative RLS (patients, audit_logs)", () => {
  it("returns zero patients rows for org B when scoped to org A", async () => {
    const rows = await queryAsOrg(orgA.id, "SELECT * FROM patients WHERE id = $1", [patientB.id]);
    expect(rows).toHaveLength(0);
  });

  it("returns zero audit_logs rows for org B when scoped to org A", async () => {
    const rows = await queryAsOrg(orgA.id, "SELECT * FROM audit_logs WHERE id = $1", [auditLogB.id]);
    expect(rows).toHaveLength(0);
  });

  it("still returns org A's own patients/audit_logs rows when scoped to org A", async () => {
    const patientRows = await queryAsOrg(orgA.id, "SELECT * FROM patients WHERE id = $1", [
      patientA.id,
    ]);
    expect(patientRows).toHaveLength(1);
    expect(patientRows[0].organizationId).toBe(orgA.id);

    const auditRows = await queryAsOrg(orgA.id, "SELECT * FROM audit_logs WHERE id = $1", [
      auditLogA.id,
    ]);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].organizationId).toBe(orgA.id);
  });

  it("returns zero rows for either org with no app.current_org_id set at all", async () => {
    const client = new Client({ connectionString: process.env.APP_DATABASE_URL });
    await client.connect();
    try {
      const result = await client.query("SELECT * FROM patients WHERE id IN ($1, $2)", [
        patientA.id,
        patientB.id,
      ]);
      expect(result.rows).toHaveLength(0);
    } finally {
      await client.end();
    }
  });
});
