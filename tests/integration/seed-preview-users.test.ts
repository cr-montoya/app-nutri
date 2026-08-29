import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { verify } from "@node-rs/argon2";
import { afterAll, describe, expect, it } from "vitest";
import { adminDb } from "../helpers/admin-db";

const execFileAsync = promisify(execFile);
const organizationSlug = "preview-clinic";
const password = "Preview1234!";
const expectedUsers = [
  ["admin@preview.example.com", "ADMIN"],
  ["frontdesk@preview.example.com", "FRONT_DESK"],
  ["nutri1@preview.example.com", "NUTRITIONIST"],
  ["nutri2@preview.example.com", "NUTRITIONIST"],
] as const;

async function runSeed() {
  await execFileAsync(process.execPath, ["prisma/seed-preview.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, SEED_PREVIEW_CONFIRM: "1" },
  });
}

async function cleanSeed() {
  const organization = await adminDb.organization.findUnique({
    where: { slug: organizationSlug },
    include: { memberships: { select: { userId: true } } },
  });
  if (!organization) return;

  const userIds = organization.memberships.map(({ userId }) => userId);
  await adminDb.$transaction([
    adminDb.professional.deleteMany({ where: { organizationId: organization.id } }),
    adminDb.membership.deleteMany({ where: { organizationId: organization.id } }),
    adminDb.user.deleteMany({ where: { id: { in: userIds } } }),
    adminDb.organization.delete({ where: { id: organization.id } }),
  ]);
}

describe("seed-preview-users", () => {
  afterAll(async () => {
    await cleanSeed();
    await adminDb.$disconnect();
  });

  it("creates the documented users, memberships, and professional profiles", async () => {
    await runSeed();

    const organization = await adminDb.organization.findUniqueOrThrow({
      where: { slug: organizationSlug },
    });
    const users = await adminDb.user.findMany({
      where: { email: { in: expectedUsers.map(([email]) => email) } },
      include: { membership: { include: { professional: true } } },
    });

    expect(users).toHaveLength(4);
    for (const [email, role] of expectedUsers) {
      const user = users.find((candidate) => candidate.email === email);
      expect(user?.membership).toMatchObject({ organizationId: organization.id, role });
      expect(await verify(user?.passwordHash ?? "", password)).toBe(true);
    }

    expect(users.filter((user) => user.membership?.professional)).toHaveLength(2);
    expect(
      users
        .filter((user) => user.membership?.professional)
        .map((user) => user.membership?.professional?.specialty)
        .sort(),
    ).toEqual(["Clinical Nutrition", "Sports Nutrition"]);
  });
});
