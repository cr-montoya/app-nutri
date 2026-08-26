import { describe, expect, it } from "vitest";
import { applyTenantScope, resolveRuntimeDatabaseUrl } from "./db";

// Two fake org ids, deliberately not real cuids, to prove the injection
// logic itself (not any particular seeded row) scopes correctly.
const ORG_A = "org_fake_a";
const ORG_B = "org_fake_b";

describe("applyTenantScope", () => {
  it("injects organizationId into where for a read operation", () => {
    const args = applyTenantScope("findMany", { where: { role: "ADMIN" } }, ORG_A);
    expect(args.where).toEqual({ role: "ADMIN", organizationId: ORG_A });
  });

  it("scopes findUnique's where to the caller's org, not the other org", () => {
    const argsA = applyTenantScope("findUnique", { where: { id: "m1" } }, ORG_A);
    const argsB = applyTenantScope("findUnique", { where: { id: "m1" } }, ORG_B);
    expect(argsA.where).toEqual({ id: "m1", organizationId: ORG_A });
    expect(argsB.where).toEqual({ id: "m1", organizationId: ORG_B });
    expect(argsA.where).not.toEqual(argsB.where);
  });

  it("does not let a caller-supplied where override the injected organizationId", () => {
    const args = applyTenantScope(
      "findMany",
      { where: { organizationId: ORG_B } },
      ORG_A
    );
    // Injection happens after the spread, so it always wins.
    expect(args.where).toEqual({ organizationId: ORG_A });
  });

  it("injects organizationId into data for create", () => {
    const args = applyTenantScope("create", { data: { role: "ADMIN" } }, ORG_A);
    expect(args.data).toEqual({ role: "ADMIN", organizationId: ORG_A });
  });

  it("injects organizationId into every row for createMany", () => {
    const args = applyTenantScope(
      "createMany",
      { data: [{ role: "ADMIN" }, { role: "NUTRITIONIST" }] },
      ORG_B
    );
    expect(args.data).toEqual([
      { role: "ADMIN", organizationId: ORG_B },
      { role: "NUTRITIONIST", organizationId: ORG_B },
    ]);
  });

  it("scopes both where and create for upsert, and drops org changes from update", () => {
    const args = applyTenantScope(
      "upsert",
      {
        where: { id: "m1" },
        create: { role: "ADMIN" },
        update: { organizationId: ORG_B, role: "FRONT_DESK" },
      },
      ORG_A
    );
    expect(args.where).toEqual({ id: "m1", organizationId: ORG_A });
    expect(args.create).toEqual({ role: "ADMIN", organizationId: ORG_A });
    // The organizationId in the update payload is stripped: an update can
    // never move a row to a different organization.
    expect(args.update).toEqual({ role: "FRONT_DESK" });
  });

  it("strips organizationId from an update payload so a row can't be re-parented", () => {
    const args = applyTenantScope(
      "update",
      { where: { id: "m1" }, data: { organizationId: ORG_B, role: "FRONT_DESK" } },
      ORG_A
    );
    expect(args.where).toEqual({ id: "m1", organizationId: ORG_A });
    expect(args.data).toEqual({ role: "FRONT_DESK" });
  });

  it("leaves operations with no where/data clause untouched", () => {
    const args = applyTenantScope("aggregate", { _count: true }, ORG_A);
    expect(args.where).toEqual({ organizationId: ORG_A });
    expect(args._count).toBe(true);
  });
});

describe("resolveRuntimeDatabaseUrl", () => {
  it("uses Neon's dynamic DATABASE_URL in a Vercel environment", () => {
    expect(
      resolveRuntimeDatabaseUrl({
        VERCEL_ENV: "preview",
        DATABASE_URL: "postgresql://preview-app-role",
        APP_DATABASE_URL: "postgresql://local-app-role",
      })
    ).toBe("postgresql://preview-app-role");
  });

  it("uses APP_DATABASE_URL outside Vercel even when DATABASE_URL is present", () => {
    expect(
      resolveRuntimeDatabaseUrl({
        DATABASE_URL: "postgresql://local-migration-owner",
        APP_DATABASE_URL: "postgresql://local-app-role",
      })
    ).toBe("postgresql://local-app-role");
  });

  it("fails closed when Vercel has no Neon runtime connection", () => {
    expect(() => resolveRuntimeDatabaseUrl({ VERCEL_ENV: "preview" })).toThrow(
      "DATABASE_URL is not set"
    );
  });

  it("fails closed when local runtime has no restricted connection", () => {
    expect(() => resolveRuntimeDatabaseUrl({ DATABASE_URL: "postgresql://owner" })).toThrow(
      "APP_DATABASE_URL is not set"
    );
  });
});
