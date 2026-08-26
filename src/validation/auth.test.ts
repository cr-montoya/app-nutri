import { describe, expect, it, vi } from "vitest";
import { registerSchema, checkPasswordNotBreached, BreachedPasswordError } from "./auth";

const VALID = {
  email: "nutri@example.test",
  name: "Nutri One",
  password: "a-valid-password-123",
  organizationName: "Clinic Example",
};

describe("registerSchema", () => {
  it("accepts valid input", () => {
    expect(registerSchema.safeParse(VALID).success).toBe(true);
  });

  it("rejects an invalid email format (REQ-003)", () => {
    const result = registerSchema.safeParse({ ...VALID, email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("rejects a password shorter than 12 characters (REQ-004)", () => {
    const result = registerSchema.safeParse({ ...VALID, password: "short11char" });
    expect(result.success).toBe(false);
  });

  it("accepts a password exactly 12 characters", () => {
    const result = registerSchema.safeParse({ ...VALID, password: "twelvecharsX" });
    expect(result.success).toBe(true);
  });

  it("rejects an organization name shorter than 2 characters after trimming (REQ-006)", () => {
    const result = registerSchema.safeParse({ ...VALID, organizationName: " a " });
    expect(result.success).toBe(false);
  });

  it("rejects an organization name longer than 100 characters after trimming (REQ-006)", () => {
    const result = registerSchema.safeParse({ ...VALID, organizationName: "x".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("trims the organization name rather than rejecting valid surrounding whitespace", () => {
    const result = registerSchema.safeParse({ ...VALID, organizationName: "  Clinic Example  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.organizationName).toBe("Clinic Example");
    }
  });

  it("rejects a name that is empty after trimming (REQ-021)", () => {
    const result = registerSchema.safeParse({ ...VALID, name: "   " });
    expect(result.success).toBe(false);
  });

  it("rejects a name longer than 100 characters (REQ-021)", () => {
    const result = registerSchema.safeParse({ ...VALID, name: "x".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("trims the name rather than rejecting valid surrounding whitespace", () => {
    const result = registerSchema.safeParse({ ...VALID, name: "  Nutri One  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Nutri One");
    }
  });
});

describe("checkPasswordNotBreached (REQ-005)", () => {
  function fakeFetch(responseBody: string, ok = true) {
    return vi.fn(async () =>
      new Response(responseBody, { status: ok ? 200 : 500 })
    ) as unknown as typeof fetch;
  }

  it("rejects a password whose hash suffix is found in the HIBP response", async () => {
    const { createHash } = await import("node:crypto");
    const sha1 = createHash("sha1").update("password", "utf8").digest("hex").toUpperCase();
    const suffix = sha1.slice(5);

    const fetchImpl = fakeFetch(`${suffix}:3730471\nOTHERSUFFIX000000000000000000000:1`);

    await expect(checkPasswordNotBreached("password", fetchImpl)).rejects.toThrow(
      BreachedPasswordError
    );
  });

  it("allows a password whose hash suffix is not in the HIBP response", async () => {
    const fetchImpl = fakeFetch("SOMEOTHERSUFFIX00000000000000000:5");
    await expect(checkPasswordNotBreached("a-unique-password-123", fetchImpl)).resolves.toBeUndefined();
  });

  it("fails open (does not throw) when the HIBP API errors", async () => {
    const fetchImpl = fakeFetch("", false);
    await expect(checkPasswordNotBreached("a-unique-password-123", fetchImpl)).resolves.toBeUndefined();
  });

  it("fails open (does not throw) when the HIBP API is unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await expect(checkPasswordNotBreached("a-unique-password-123", fetchImpl)).resolves.toBeUndefined();
  });

  it("never sends the full password or its full hash, only the 5-char prefix", async () => {
    const fetchImpl = fakeFetch("");
    await checkPasswordNotBreached("a-unique-password-123", fetchImpl);

    const calledUrl = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).not.toContain("a-unique-password-123");
    expect(calledUrl).toMatch(/\/range\/[0-9A-F]{5}$/);
  });
});
