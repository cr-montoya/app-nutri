import { verify } from "@node-rs/argon2";
import { describe, expect, it } from "vitest";
import { adminDb } from "../helpers/admin-db";
import {
  previewSeedOrganizationSlug,
  runPreviewSeed,
  usePreviewSeedTestLifecycle,
} from "../helpers/preview-seed";

const password = "Preview1234!";
const expectedUsers = [
  ["admin@preview.example.com", "ADMIN"],
  ["frontdesk@preview.example.com", "FRONT_DESK"],
  ["nutri1@preview.example.com", "NUTRITIONIST"],
  ["nutri2@preview.example.com", "NUTRITIONIST"],
] as const;

describe("seed-preview-users", () => {
  usePreviewSeedTestLifecycle();

  it("creates the documented users, memberships, and professional profiles", async () => {
    await runPreviewSeed();

    const organization = await adminDb.organization.findUniqueOrThrow({
      where: { slug: previewSeedOrganizationSlug },
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
  }, 30_000);
});
