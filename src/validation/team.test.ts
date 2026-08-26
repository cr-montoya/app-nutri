import { describe, expect, it } from "vitest";
import { sendInviteSchema } from "./team";

const VALID = {
  email: "invitee@example.test",
  role: "NUTRITIONIST",
};

describe("sendInviteSchema (REQ-002)", () => {
  it("accepts a valid email and role", () => {
    expect(sendInviteSchema.safeParse(VALID).success).toBe(true);
  });

  it("accepts each allowed role", () => {
    for (const role of ["ADMIN", "NUTRITIONIST", "FRONT_DESK"]) {
      expect(sendInviteSchema.safeParse({ ...VALID, role }).success).toBe(true);
    }
  });

  it("rejects an invalid email format", () => {
    const result = sendInviteSchema.safeParse({ ...VALID, email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("rejects a role outside the Role enum", () => {
    const result = sendInviteSchema.safeParse({ ...VALID, role: "SUPERADMIN" });
    expect(result.success).toBe(false);
  });

  it("trims and lowercases the email rather than rejecting valid surrounding whitespace/case", () => {
    const result = sendInviteSchema.safeParse({ ...VALID, email: "  Invitee@Example.TEST  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("invitee@example.test");
    }
  });
});
