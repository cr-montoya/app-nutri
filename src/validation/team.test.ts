import { describe, expect, it } from "vitest";
import { sendInviteSchema, acceptInviteSchema } from "./team";

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

const VALID_ACCEPT = {
  name: "Invited Nutritionist",
  password: "a-valid-password-123",
};

describe("acceptInviteSchema (REQ-007, REQ-008)", () => {
  it("accepts a valid name and password", () => {
    expect(acceptInviteSchema.safeParse(VALID_ACCEPT).success).toBe(true);
  });

  it("rejects a name that is empty after trimming (REQ-007)", () => {
    const result = acceptInviteSchema.safeParse({ ...VALID_ACCEPT, name: "   " });
    expect(result.success).toBe(false);
  });

  it("rejects a name longer than 100 characters (REQ-007)", () => {
    const result = acceptInviteSchema.safeParse({ ...VALID_ACCEPT, name: "x".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("trims the name rather than rejecting valid surrounding whitespace", () => {
    const result = acceptInviteSchema.safeParse({ ...VALID_ACCEPT, name: "  Invited Nutritionist  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Invited Nutritionist");
    }
  });

  it("rejects a password shorter than 12 characters (REQ-008)", () => {
    const result = acceptInviteSchema.safeParse({ ...VALID_ACCEPT, password: "short11char" });
    expect(result.success).toBe(false);
  });

  it("accepts a password exactly 12 characters", () => {
    const result = acceptInviteSchema.safeParse({ ...VALID_ACCEPT, password: "twelvecharsX" });
    expect(result.success).toBe(true);
  });

  it("has no email field: the invited email is not client-writable input", () => {
    const result = acceptInviteSchema.safeParse({ ...VALID_ACCEPT, email: "attacker@example.test" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).email).toBeUndefined();
    }
  });
});
