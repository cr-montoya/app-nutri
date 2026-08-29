import { describe, expect, it } from "vitest";
import {
  appointmentFieldsSchema,
  createAppointmentSchema,
  resolveAppointmentRange,
  formatBogotaDateAndTime,
} from "./appointments";

const VALID_FIELDS = {
  professionalId: "prof-1",
  date: "2027-06-15",
  time: "14:00",
};

describe("appointmentFieldsSchema (REQ-001)", () => {
  it("accepts the minimum required fields", () => {
    expect(appointmentFieldsSchema.safeParse(VALID_FIELDS).success).toBe(true);
  });

  it("accepts every optional field left blank", () => {
    const result = appointmentFieldsSchema.safeParse({
      ...VALID_FIELDS,
      durationMinutes: "",
      reason: "",
      notes: "",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing professionalId", () => {
    expect(appointmentFieldsSchema.safeParse({ ...VALID_FIELDS, professionalId: "" }).success).toBe(
      false
    );
  });

  it("rejects a malformed date or time", () => {
    expect(appointmentFieldsSchema.safeParse({ ...VALID_FIELDS, date: "15-06-2027" }).success).toBe(
      false
    );
    expect(appointmentFieldsSchema.safeParse({ ...VALID_FIELDS, time: "2pm" }).success).toBe(false);
  });
});

describe("appointmentFieldsSchema.reason (REQ-009)", () => {
  it("accepts a reason up to 200 characters", () => {
    expect(
      appointmentFieldsSchema.safeParse({ ...VALID_FIELDS, reason: "x".repeat(200) }).success
    ).toBe(true);
  });

  it("rejects a reason longer than 200 characters", () => {
    expect(
      appointmentFieldsSchema.safeParse({ ...VALID_FIELDS, reason: "x".repeat(201) }).success
    ).toBe(false);
  });
});

describe("appointmentFieldsSchema.notes (REQ-010)", () => {
  it("accepts notes up to 2000 characters", () => {
    expect(
      appointmentFieldsSchema.safeParse({ ...VALID_FIELDS, notes: "x".repeat(2000) }).success
    ).toBe(true);
  });

  it("rejects notes longer than 2000 characters", () => {
    expect(
      appointmentFieldsSchema.safeParse({ ...VALID_FIELDS, notes: "x".repeat(2001) }).success
    ).toBe(false);
  });
});

describe("createAppointmentSchema", () => {
  it("requires patientId in addition to the shared fields", () => {
    expect(createAppointmentSchema.safeParse(VALID_FIELDS).success).toBe(false);
    expect(
      createAppointmentSchema.safeParse({ ...VALID_FIELDS, patientId: "patient-1" }).success
    ).toBe(true);
  });
});

describe("resolveAppointmentRange (REQ-002 through REQ-005)", () => {
  const now = new Date("2027-01-01T00:00:00.000Z");

  it("defaults duration to 30 minutes when not provided", () => {
    const result = resolveAppointmentRange({ date: "2027-06-15", time: "14:00" }, now);
    expect(result.error).toBeUndefined();
    expect(result.endAt!.getTime() - result.startAt!.getTime()).toBe(30 * 60_000);
  });

  it("accepts an explicit duration within 5-480 minutes", () => {
    const result = resolveAppointmentRange(
      { date: "2027-06-15", time: "14:00", durationMinutes: "60" },
      now
    );
    expect(result.error).toBeUndefined();
    expect(result.endAt!.getTime() - result.startAt!.getTime()).toBe(60 * 60_000);
  });

  it("rejects a duration shorter than 5 minutes", () => {
    const result = resolveAppointmentRange(
      { date: "2027-06-15", time: "14:00", durationMinutes: "4" },
      now
    );
    expect(result.error).toBeTruthy();
  });

  it("rejects a duration longer than 480 minutes", () => {
    const result = resolveAppointmentRange(
      { date: "2027-06-15", time: "14:00", durationMinutes: "481" },
      now
    );
    expect(result.error).toBeTruthy();
  });

  it("accepts the boundary durations 5 and 480", () => {
    expect(
      resolveAppointmentRange({ date: "2027-06-15", time: "14:00", durationMinutes: "5" }, now).error
    ).toBeUndefined();
    expect(
      resolveAppointmentRange({ date: "2027-06-15", time: "14:00", durationMinutes: "480" }, now)
        .error
    ).toBeUndefined();
  });

  it("rejects a start date/time in the past", () => {
    const result = resolveAppointmentRange({ date: "2026-01-01", time: "00:00" }, now);
    expect(result.error).toBeTruthy();
    expect(result.startAt).toBeUndefined();
  });

  it("converts America/Bogota (UTC-5) local time to the correct UTC instant", () => {
    const result = resolveAppointmentRange({ date: "2027-06-15", time: "14:00" }, now);
    expect(result.error).toBeUndefined();
    // 14:00 Bogota (UTC-5) == 19:00 UTC.
    expect(result.startAt!.toISOString()).toBe("2027-06-15T19:00:00.000Z");
  });
});

describe("formatBogotaDateAndTime (REQ-005)", () => {
  it("is the inverse of resolveAppointmentRange's date/time parsing", () => {
    const utcInstant = new Date("2027-06-15T19:00:00.000Z");
    expect(formatBogotaDateAndTime(utcInstant)).toEqual({ date: "2027-06-15", time: "14:00" });
  });

  it("handles the UTC day rolling back a day in Bogota local time", () => {
    // 02:00 UTC on the 16th is 21:00 Bogota on the 15th.
    const utcInstant = new Date("2027-06-16T02:00:00.000Z");
    expect(formatBogotaDateAndTime(utcInstant)).toEqual({ date: "2027-06-15", time: "21:00" });
  });
});
