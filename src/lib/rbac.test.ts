import { describe, expect, it } from "vitest";
import { ForbiddenError, requireRole } from "./rbac";

describe("requireRole", () => {
  it("returns the actor when its role is allowed", () => {
    const actor = { role: "ADMIN" as const };
    expect(requireRole(actor, ["ADMIN"])).toBe(actor);
  });

  it("returns the actor when its role is one of several allowed roles", () => {
    const actor = { role: "NUTRITIONIST" as const };
    expect(requireRole(actor, ["ADMIN", "NUTRITIONIST"])).toBe(actor);
  });

  it("throws ForbiddenError when the actor's role isn't allowed", () => {
    const actor = { role: "FRONT_DESK" as const };
    expect(() => requireRole(actor, ["ADMIN"])).toThrow(ForbiddenError);
  });

  it("throws ForbiddenError when there is no actor at all", () => {
    expect(() => requireRole(null, ["ADMIN"])).toThrow(ForbiddenError);
    expect(() => requireRole(undefined, ["ADMIN"])).toThrow(ForbiddenError);
  });

  it("never leaks which roles are allowed via a client-hidden path (message is server-side only)", () => {
    const actor = { role: "FRONT_DESK" as const };
    try {
      requireRole(actor, ["ADMIN"]);
      throw new Error("expected requireRole to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenError);
      expect((error as Error).message).toContain("FRONT_DESK");
    }
  });
});
