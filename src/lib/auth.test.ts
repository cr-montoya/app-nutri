import { beforeEach, describe, expect, it, vi } from "vitest";
import { hash } from "@node-rs/argon2";
import {
  authorizeCredentials,
  refreshOrInvalidate,
  EIGHT_HOURS_IN_SECONDS,
  type AppJWT,
} from "./auth-core";

vi.mock("./db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

const { db } = await import("./db");
const findUnique = vi.mocked(db.user.findUnique);

const REAL_PASSWORD = "a-correct-password-123";
let passwordHash: string;

beforeEach(async () => {
  findUnique.mockReset();
  passwordHash = await hash(REAL_PASSWORD);
});

describe("authorizeCredentials (REQ-008, REQ-009, REQ-010)", () => {
  it("returns the user's id, org id, and tokenVersion on a correct password", async () => {
    findUnique.mockResolvedValue({
      id: "user_1",
      email: "nutri@example.test",
      name: "Nutri One",
      passwordHash,
      tokenVersion: 0,
      createdAt: new Date(),
      membership: { organizationId: "org_1" },
    } as never);

    const result = await authorizeCredentials({
      email: "nutri@example.test",
      password: REAL_PASSWORD,
    });

    expect(result).toEqual({
      id: "user_1",
      email: "nutri@example.test",
      name: "Nutri One",
      organizationId: "org_1",
      tokenVersion: 0,
    });
  });

  it("returns null for a wrong password, without revealing that the email was valid", async () => {
    findUnique.mockResolvedValue({
      id: "user_1",
      email: "nutri@example.test",
      name: "Nutri One",
      passwordHash,
      tokenVersion: 0,
      createdAt: new Date(),
      membership: { organizationId: "org_1" },
    } as never);

    const result = await authorizeCredentials({
      email: "nutri@example.test",
      password: "wrong-password",
    });

    expect(result).toBeNull();
  });

  it("returns null for an email that doesn't exist, same as a wrong password", async () => {
    findUnique.mockResolvedValue(null);

    const result = await authorizeCredentials({
      email: "nobody@example.test",
      password: REAL_PASSWORD,
    });

    expect(result).toBeNull();
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it("returns null when credentials are missing or not strings", async () => {
    expect(await authorizeCredentials(undefined)).toBeNull();
    expect(await authorizeCredentials({ email: "a@b.test" })).toBeNull();
    expect(await authorizeCredentials({ email: 5, password: REAL_PASSWORD })).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("never stores or returns the plaintext password", async () => {
    findUnique.mockResolvedValue({
      id: "user_1",
      email: "nutri@example.test",
      name: "Nutri One",
      passwordHash,
      tokenVersion: 0,
      createdAt: new Date(),
      membership: { organizationId: "org_1" },
    } as never);

    const result = await authorizeCredentials({
      email: "nutri@example.test",
      password: REAL_PASSWORD,
    });

    expect(JSON.stringify(result)).not.toContain(REAL_PASSWORD);
    expect(JSON.stringify(result)).not.toContain("passwordHash");
  });
});

describe("refreshOrInvalidate (REQ-018)", () => {
  it("keeps the token when tokenVersion still matches the database", async () => {
    findUnique.mockResolvedValue({ tokenVersion: 2 } as never);

    const token: AppJWT = { userId: "user_1", tokenVersion: 2 };
    const result = await refreshOrInvalidate(token);

    expect(result).toBe(token);
  });

  it("invalidates the session (returns null) when tokenVersion no longer matches", async () => {
    findUnique.mockResolvedValue({ tokenVersion: 3 } as never);

    const token: AppJWT = { userId: "user_1", tokenVersion: 2 };
    const result = await refreshOrInvalidate(token);

    expect(result).toBeNull();
  });

  it("invalidates the session when the user no longer exists", async () => {
    findUnique.mockResolvedValue(null);

    const token: AppJWT = { userId: "user_deleted", tokenVersion: 0 };
    const result = await refreshOrInvalidate(token);

    expect(result).toBeNull();
  });

  it("passes through a token with no userId (nothing to check yet)", async () => {
    const token: AppJWT = {};
    const result = await refreshOrInvalidate(token);

    expect(result).toBe(token);
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe("session configuration (REQ-011)", () => {
  it("expires after at most 8 hours", () => {
    expect(EIGHT_HOURS_IN_SECONDS).toBe(60 * 60 * 8);
  });
});
