import { describe, expect, it } from "vitest";
import { patientSchema } from "./patients";

const VALID = {
  fullName: "Jane Doe",
  phone: "+15551234567",
};

describe("patientSchema (REQ-001)", () => {
  it("accepts the minimum required fields (name and phone only)", () => {
    const result = patientSchema.safeParse(VALID);
    expect(result.success).toBe(true);
  });

  it("accepts every optional field left blank (empty string)", () => {
    const result = patientSchema.safeParse({
      ...VALID,
      documentId: "",
      birthDate: "",
      sex: "",
      email: "",
      address: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.documentId).toBeUndefined();
      expect(result.data.birthDate).toBeUndefined();
      expect(result.data.sex).toBeUndefined();
      expect(result.data.email).toBeUndefined();
    }
  });
});

describe("patientSchema.fullName (REQ-002)", () => {
  it("rejects a name that is empty after trimming", () => {
    expect(patientSchema.safeParse({ ...VALID, fullName: "   " }).success).toBe(false);
  });

  it("rejects a name longer than 200 characters", () => {
    expect(patientSchema.safeParse({ ...VALID, fullName: "x".repeat(201) }).success).toBe(false);
  });

  it("accepts a name exactly 200 characters", () => {
    expect(patientSchema.safeParse({ ...VALID, fullName: "x".repeat(200) }).success).toBe(true);
  });
});

describe("patientSchema.phone (REQ-003)", () => {
  it("accepts a phone with no leading +", () => {
    expect(patientSchema.safeParse({ ...VALID, phone: "5551234567" }).success).toBe(true);
  });

  it("accepts the minimum 7 digits", () => {
    expect(patientSchema.safeParse({ ...VALID, phone: "5551234" }).success).toBe(true);
  });

  it("accepts the maximum 15 digits", () => {
    expect(patientSchema.safeParse({ ...VALID, phone: "+" + "5".repeat(15) }).success).toBe(true);
  });

  it("rejects fewer than 7 digits", () => {
    expect(patientSchema.safeParse({ ...VALID, phone: "12345" }).success).toBe(false);
  });

  it("rejects more than 15 digits", () => {
    expect(patientSchema.safeParse({ ...VALID, phone: "5".repeat(16) }).success).toBe(false);
  });

  it("rejects non-digit characters", () => {
    expect(patientSchema.safeParse({ ...VALID, phone: "555-123-4567" }).success).toBe(false);
  });
});

describe("patientSchema.documentId (REQ-004)", () => {
  it("accepts a document id up to 50 characters", () => {
    expect(patientSchema.safeParse({ ...VALID, documentId: "x".repeat(50) }).success).toBe(true);
  });

  it("rejects a document id longer than 50 characters", () => {
    expect(patientSchema.safeParse({ ...VALID, documentId: "x".repeat(51) }).success).toBe(false);
  });

  it("rejects a whitespace-only document id (empty after trimming)", () => {
    expect(patientSchema.safeParse({ ...VALID, documentId: "   " }).success).toBe(false);
  });

  it("trims a valid document id", () => {
    const result = patientSchema.safeParse({ ...VALID, documentId: "  ABC-123  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.documentId).toBe("ABC-123");
    }
  });
});

describe("patientSchema.birthDate (REQ-008)", () => {
  it("accepts a birth date in the past", () => {
    expect(patientSchema.safeParse({ ...VALID, birthDate: "1990-01-01" }).success).toBe(true);
  });

  it("rejects a birth date in the future", () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365);
    const result = patientSchema.safeParse({
      ...VALID,
      birthDate: future.toISOString().slice(0, 10),
    });
    expect(result.success).toBe(false);
  });
});

describe("patientSchema.sex (REQ-010)", () => {
  it("accepts MALE and FEMALE", () => {
    expect(patientSchema.safeParse({ ...VALID, sex: "MALE" }).success).toBe(true);
    expect(patientSchema.safeParse({ ...VALID, sex: "FEMALE" }).success).toBe(true);
  });

  it("rejects a value outside MALE/FEMALE", () => {
    expect(patientSchema.safeParse({ ...VALID, sex: "OTHER" }).success).toBe(false);
  });
});

describe("patientSchema.email (REQ-009)", () => {
  it("accepts a valid email", () => {
    expect(patientSchema.safeParse({ ...VALID, email: "patient@example.test" }).success).toBe(true);
  });

  it("rejects an invalid email format", () => {
    expect(patientSchema.safeParse({ ...VALID, email: "not-an-email" }).success).toBe(false);
  });
});

describe("patientSchema.address (REQ-011)", () => {
  it("accepts an address up to 300 characters", () => {
    expect(patientSchema.safeParse({ ...VALID, address: "x".repeat(300) }).success).toBe(true);
  });

  it("rejects an address longer than 300 characters", () => {
    expect(patientSchema.safeParse({ ...VALID, address: "x".repeat(301) }).success).toBe(false);
  });
});
