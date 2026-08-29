import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { adminDb } from "../helpers/admin-db";

/**
 * Negative RLS test (T1.6, closes REQ-022): a raw `pg` client -- bypassing
 * Prisma and the `withTenant` extension entirely -- with
 * `app.current_org_id` set to org A must still get zero rows querying org
 * B's `appointments` directly. Same pattern as
 * tests/integration/patient-rls-negative.test.ts; this is what proves RLS
 * itself (not just the Prisma Client Extension) enforces isolation for
 * this table too.
 */

const runId = Date.now();

let orgA: { id: string };
let orgB: { id: string };
let membershipA: { id: string };
let membershipB: { id: string };
let professionalA: { id: string };
let professionalB: { id: string };
let patientA: { id: string };
let patientB: { id: string };
let appointmentA: { id: string };
let appointmentB: { id: string };

beforeAll(async () => {
  orgA = await adminDb.organization.create({
    data: { name: "Appointment RLS Negative Org A", slug: `appointment-rls-negative-org-a-${runId}` },
  });
  orgB = await adminDb.organization.create({
    data: { name: "Appointment RLS Negative Org B", slug: `appointment-rls-negative-org-b-${runId}` },
  });
  const userA = await adminDb.user.create({
    data: { email: `appointment-rls-negative-a-${runId}@example.test`, passwordHash: "x", name: "User A" },
  });
  const userB = await adminDb.user.create({
    data: { email: `appointment-rls-negative-b-${runId}@example.test`, passwordHash: "x", name: "User B" },
  });
  membershipA = await adminDb.membership.create({
    data: { userId: userA.id, organizationId: orgA.id, role: "NUTRITIONIST" },
  });
  membershipB = await adminDb.membership.create({
    data: { userId: userB.id, organizationId: orgB.id, role: "NUTRITIONIST" },
  });
  professionalA = await adminDb.professional.create({
    data: { membershipId: membershipA.id, organizationId: orgA.id, licenseNumber: "LIC-NEG-A" },
  });
  professionalB = await adminDb.professional.create({
    data: { membershipId: membershipB.id, organizationId: orgB.id, licenseNumber: "LIC-NEG-B" },
  });
  patientA = await adminDb.patient.create({
    data: { organizationId: orgA.id, fullName: "Negative RLS Patient A", phone: "+15551110000" },
  });
  patientB = await adminDb.patient.create({
    data: { organizationId: orgB.id, fullName: "Negative RLS Patient B", phone: "+15552220000" },
  });
  appointmentA = await adminDb.appointment.create({
    data: {
      organizationId: orgA.id,
      patientId: patientA.id,
      professionalId: professionalA.id,
      startAt: new Date("2027-02-01T14:00:00.000Z"),
      endAt: new Date("2027-02-01T14:30:00.000Z"),
    },
  });
  appointmentB = await adminDb.appointment.create({
    data: {
      organizationId: orgB.id,
      patientId: patientB.id,
      professionalId: professionalB.id,
      startAt: new Date("2027-02-01T15:00:00.000Z"),
      endAt: new Date("2027-02-01T15:30:00.000Z"),
    },
  });
});

afterAll(async () => {
  await adminDb.appointment.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await adminDb.patient.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await adminDb.professional.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await adminDb.membership.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
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

describe("Raw pg client: negative RLS (appointments)", () => {
  it("returns zero appointments rows for org B when scoped to org A", async () => {
    const rows = await queryAsOrg(orgA.id, "SELECT * FROM appointments WHERE id = $1", [
      appointmentB.id,
    ]);
    expect(rows).toHaveLength(0);
  });

  it("still returns org A's own appointments rows when scoped to org A", async () => {
    const rows = await queryAsOrg(orgA.id, "SELECT * FROM appointments WHERE id = $1", [
      appointmentA.id,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].organizationId).toBe(orgA.id);
  });

  it("returns zero rows for either org with no app.current_org_id set at all", async () => {
    const client = new Client({ connectionString: process.env.APP_DATABASE_URL });
    await client.connect();
    try {
      const result = await client.query("SELECT * FROM appointments WHERE id IN ($1, $2)", [
        appointmentA.id,
        appointmentB.id,
      ]);
      expect(result.rows).toHaveLength(0);
    } finally {
      await client.end();
    }
  });
});
